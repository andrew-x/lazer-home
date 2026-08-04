"use server";

import { env } from "@/env";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { isDriveFolder } from "@/lib/drive/folder";
import {
  DriveApiError,
  driveFileSchema,
  driveGetFile,
  drivePost,
  isDriveConfigured,
} from "./driveApi";
import { copyDriveFileSchema } from "./driveFolder.schema";
import { requireDriveAccessToken } from "./driveToken";

/**
 * Copy a file the user picked in the Google Picker into a shared-drive folder.
 *
 * **This is the only code path in the feature that reads a file outside the Lazer
 * Home shared drive, and it is the privacy invariant's third leg** (see
 * docs/decisions/0069):
 *
 * - The `fileId` always comes from a Picker selection — the user's own click, in
 *   Google's own UI. Nothing here searches or enumerates their Drive; we never
 *   learn what else they have.
 * - It **copies**, never moves. `files.copy` with a `parents` destination leaves
 *   the original exactly where it was, so pulling a file into a project folder
 *   can't quietly remove it from someone's own Drive.
 * - The destination is checked to be inside the shared drive, so this can't be
 *   turned into a general-purpose "copy anything anywhere" endpoint.
 *
 * It carries no capability for the same reason browsing doesn't: it runs on the
 * user's own token, so Google enforces both their read access to the source and
 * their write access to the destination. There is nothing our gate could add.
 */
export const copyDriveFile = secureActionClient
  .metadata({ action: "copy-drive-file" })
  .inputSchema(copyDriveFileSchema)
  .action(async ({ parsedInput: { folderId, fileId }, ctx: { user } }) => {
    if (!isDriveConfigured()) {
      throw new UserSafeActionError("Google Drive isn't connected.");
    }

    const accessToken = await requireDriveAccessToken(user.id);

    // Resolve the destination first: a wrong folder is worth catching before we
    // read the source, and this is what confines copies to the shared drive.
    const destination = await readFile(
      folderId,
      accessToken,
      "We can't find that folder in Drive any more.",
    );
    if (!isDriveFolder(destination.mimeType)) {
      throw new UserSafeActionError("That destination isn't a folder.");
    }
    if (destination.driveId !== env.GOOGLE_DRIVE_ROOT_ID) {
      throw new UserSafeActionError(
        "Files can only be added to folders inside the Lazer Home shared drive.",
      );
    }

    // Read the source's name server-side rather than trusting one from the
    // client, so the copy can't be given a name that misrepresents it.
    const source = await readFile(
      fileId,
      accessToken,
      "We can't read that file — you may no longer have access to it.",
    );
    if (isDriveFolder(source.mimeType)) {
      throw new UserSafeActionError(
        "Folders can't be copied in here — add the files inside it instead.",
      );
    }

    try {
      const copy = await drivePost(
        `/files/${encodeURIComponent(fileId)}/copy`,
        { fields: "id,name,mimeType,webViewLink" },
        { name: source.name, parents: [folderId] },
        accessToken,
        driveFileSchema,
      );
      return { fileId: copy.id, name: copy.name };
    } catch (error) {
      throw copyFailureError(error);
    }
  });

async function readFile(
  id: string,
  accessToken: string,
  notFoundMessage: string,
): Promise<Awaited<ReturnType<typeof driveGetFile>>> {
  try {
    return await driveGetFile(id, accessToken);
  } catch (error) {
    if (error instanceof DriveApiError && error.status === 401) {
      throw new UserSafeActionError(
        "Reconnect your Google account to use Drive.",
      );
    }
    throw new UserSafeActionError(notFoundMessage);
  }
}

/** Turn a failed copy into copy that names the actual obstacle. */
function copyFailureError(error: unknown): UserSafeActionError {
  if (!(error instanceof DriveApiError)) {
    return new UserSafeActionError("Couldn't copy that file into the folder.");
  }

  switch (error.code) {
    case "cannotCopyFile":
      // The owner set "viewers cannot copy" on the original. The most likely
      // real-world failure here, and one only they can undo — so say so rather
      // than leaving the user retrying.
      return new UserSafeActionError(
        "The owner of that file has disabled copying. Ask them to share it another way.",
      );
    case "insufficientFilePermissions":
    case "forbidden":
      return new UserSafeActionError(
        "You don't have permission to add files to this folder.",
      );
    case "storageQuotaExceeded":
      return new UserSafeActionError(
        "The shared drive is out of space. Ask an admin to free some up.",
      );
    case "rateLimitExceeded":
    case "userRateLimitExceeded":
      return new UserSafeActionError("Drive is busy — try again in a moment.");
    default:
      if (error.status === 401) {
        return new UserSafeActionError(
          "Reconnect your Google account to use Drive.",
        );
      }
      logger.warn("drive_file_copy_failed", {
        code: error.code,
        status: error.status,
      });
      return new UserSafeActionError(
        "Couldn't copy that file into the folder.",
      );
  }
}
