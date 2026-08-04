"use server";

import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { isUniqueViolation } from "@/lib/db/unique-violation";
import {
  buildDriveFolderName,
  DRIVE_PARENT_FOLDER_NAME,
} from "@/lib/drive/folder";
import { authorizeDriveFolder } from "./authorizeDriveFolder";
import {
  DRIVE_NOT_CONFIGURED,
  DriveApiError,
  driveCreateFolder,
  driveDelete,
  driveFindFolderByName,
  isDriveConfigured,
  resolveParentFolder,
} from "./driveApi";
import { createDriveFolderSchema } from "./driveFolder.schema";
import { DRIVE_FOLDER_TARGETS } from "./driveFolderLink";
import { requireDriveAccessToken } from "./driveToken";

/**
 * Create this record's folder in the Lazer Home shared drive and link it.
 *
 * **The step order is the design, not incidental.** Creating a folder in Drive is
 * not transactional with our DB write, so the two can disagree. The ordering
 * below keeps the window as small as possible and makes the recovery exact:
 *
 * 1. Read the record — refuse a missing one or an already-filled slot before
 *    anything external happens.
 * 2. Resolve (or create) the `Sales` / `Projects` parent.
 * 3. Precheck for a folder of that name already under the parent. Refusing here,
 *    pointing at "link it instead", is much better than silently creating a
 *    second folder with the same name — Drive permits duplicates, and two folders
 *    called "Acme Rebuild" is a mess no one can untangle later.
 * 4. Create the folder — the first irreversible-ish step.
 * 5. Link it under the `isNull` guard.
 * 6. If the link lost the race, DELETE the folder we just made.
 *
 * Step 6 is where this diverges from the Slack equivalent, and it's strictly
 * better: Slack has no `conversations.delete`, so an orphaned channel could only
 * be archived. Drive has a real delete, and the folder is empty and seconds old,
 * so the compensating action is exact rather than a best effort.
 */
export const createDriveFolder = secureActionClient
  .metadata({
    action: "create-drive-folder",
    authorize: authorizeDriveFolder,
  })
  .inputSchema(createDriveFolderSchema)
  .action(async ({ parsedInput: { kind, recordId }, ctx: { user } }) => {
    const target = DRIVE_FOLDER_TARGETS[kind];

    if (!isDriveConfigured()) {
      throw new UserSafeActionError("Google Drive isn't connected.");
    }

    const record = await target.read(recordId);
    if (!record) throw new UserSafeActionError("That record no longer exists.");
    if (record.folderId) {
      throw new UserSafeActionError(
        `This ${target.label.toLowerCase()} is already linked.`,
      );
    }

    const accessToken = await requireDriveAccessToken(user.id);
    const folderName = buildDriveFolderName(record.sourceName);
    if (!folderName) {
      // A record whose name is blank or whitespace-only would produce a folder
      // Drive rejects, at the end of a flow. Say so up front instead.
      throw new UserSafeActionError(
        "Give this record a name before creating its folder.",
      );
    }

    let createdFolderId: string | null = null;
    try {
      const parentId = await resolveParentFolder(kind, accessToken);

      const existing = await driveFindFolderByName(
        folderName,
        parentId,
        accessToken,
      );
      if (existing) {
        throw new UserSafeActionError(
          `A folder called "${folderName}" already exists in ${DRIVE_PARENT_FOLDER_NAME[kind]} — link it instead of creating another.`,
        );
      }

      const folder = await driveCreateFolder(folderName, parentId, accessToken);
      createdFolderId = folder.id;

      // Store the name Drive returned, not the one we asked for — Drive is the
      // authority on what the folder is actually called.
      const linked = await target.link(recordId, {
        id: folder.id,
        name: folder.name,
      });
      if (!linked) {
        throw new UserSafeActionError(
          "That slot was just filled — reload and try again.",
        );
      }

      createdFolderId = null; // Linked: no longer orphaned, don't clean it up.
      target.revalidate(recordId);

      return { folderId: folder.id, folderName: folder.name };
    } catch (error) {
      if (createdFolderId) {
        await deleteQuietly(createdFolderId, accessToken, folderName);
      }
      if (error instanceof UserSafeActionError) throw error;
      if (isUniqueViolation(error, target.uniqueConstraint)) {
        throw new UserSafeActionError(
          "That folder is already linked to another record.",
        );
      }
      throw createFailureError(error);
    }
  });

/**
 * Undo a create whose link then failed. Best effort by necessity: if this also
 * fails there is nothing further to try, so log loudly enough that someone can
 * find and delete the stray folder by hand.
 */
async function deleteQuietly(
  folderId: string,
  accessToken: string,
  folderName: string,
): Promise<void> {
  try {
    await driveDelete(folderId, accessToken);
  } catch (error) {
    logger.error("drive_folder_orphaned", {
      folderId,
      folderName,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Turn a Drive failure into copy that tells the person what to do about it. */
function createFailureError(error: unknown): UserSafeActionError {
  if (!(error instanceof DriveApiError)) {
    return new UserSafeActionError("Couldn't create the folder in Drive.");
  }

  switch (error.code) {
    case DRIVE_NOT_CONFIGURED:
      return new UserSafeActionError("Google Drive isn't connected.");
    case "insufficientFilePermissions":
    case "forbidden":
      return new UserSafeActionError(
        "You don't have permission to add folders to the Lazer Home shared drive.",
      );
    case "notFound":
      // The configured shared drive id is wrong or the app was removed from it.
      // A setup bug, not something the user did — log it as one.
      logger.error("drive_root_not_found", { code: error.code });
      return new UserSafeActionError(
        "The Lazer Home shared drive isn't reachable. Ask an admin to check the Drive setup.",
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
      logger.warn("drive_folder_create_failed", {
        code: error.code,
        status: error.status,
      });
      return new UserSafeActionError("Couldn't create the folder in Drive.");
  }
}
