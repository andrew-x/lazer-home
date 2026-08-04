"use server";

import { env } from "@/env";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { isUniqueViolation } from "@/lib/db/unique-violation";
import { isDriveFolder } from "@/lib/drive/folder";
import { authorizeDriveFolder } from "./authorizeDriveFolder";
import { DriveApiError, driveGetFile, isDriveConfigured } from "./driveApi";
import { linkDriveFolderSchema } from "./driveFolder.schema";
import {
  DRIVE_FOLDER_TARGETS,
  folderIdsAlreadyLinked,
} from "./driveFolderLink";
import { requireDriveAccessToken } from "./driveToken";

/**
 * Point a record at a folder that already exists in the Lazer Home shared drive.
 *
 * Three deliberate non-behaviours:
 *
 * - **It never takes a folder name from the client.** Only the id crosses the
 *   wire; the stored name is read back from Drive here, so the displayed name
 *   can't be made to disagree with the folder it links to.
 * - **It never touches the folder.** No renaming, no moving, no permission
 *   changes. Linking is a statement about our records, not an action in Drive.
 * - **It requires no naming convention.** Any folder in the shared drive is
 *   linkable — adopting folders that predate the convention is much of the point.
 *   Creating is what enforces the naming.
 *
 * The two checks it does make are the ones that would otherwise store nonsense:
 * the id must resolve to a folder (not a file) that actually lives in the Lazer
 * Home shared drive, and it must not already belong to another record.
 */
export const linkDriveFolder = secureActionClient
  .metadata({
    action: "link-drive-folder",
    authorize: authorizeDriveFolder,
  })
  .inputSchema(linkDriveFolderSchema)
  .action(
    async ({ parsedInput: { kind, recordId, folderId }, ctx: { user } }) => {
      const target = DRIVE_FOLDER_TARGETS[kind];

      if (!isDriveConfigured()) {
        throw new UserSafeActionError("Google Drive isn't connected.");
      }

      const record = await target.read(recordId);
      if (!record)
        throw new UserSafeActionError("That record no longer exists.");
      if (record.folderId) {
        throw new UserSafeActionError(
          `This ${target.label.toLowerCase()} is already linked.`,
        );
      }

      const accessToken = await requireDriveAccessToken(user.id);

      let folder: Awaited<ReturnType<typeof driveGetFile>>;
      try {
        folder = await driveGetFile(folderId, accessToken);
      } catch (error) {
        if (error instanceof DriveApiError && error.status === 401) {
          throw new UserSafeActionError(
            "Reconnect your Google account to use Drive.",
          );
        }
        throw new UserSafeActionError(
          "We can't find that folder in Drive, or you don't have access to it.",
        );
      }

      if (!isDriveFolder(folder.mimeType)) {
        throw new UserSafeActionError("That's a file, not a folder.");
      }

      // Confine links to the shared drive. Without this a link could point at a
      // folder in someone's personal Drive, which nobody else could open — the
      // link would look fine and be useless to the rest of the company.
      if (folder.driveId !== env.GOOGLE_DRIVE_ROOT_ID) {
        throw new UserSafeActionError(
          "Pick a folder inside the Lazer Home shared drive so everyone can reach it.",
        );
      }

      const taken = await folderIdsAlreadyLinked([folder.id]);
      if (taken.has(folder.id)) {
        throw new UserSafeActionError(
          "That folder is already linked to another record.",
        );
      }

      try {
        const linked = await target.link(recordId, {
          id: folder.id,
          name: folder.name,
        });
        if (!linked) {
          // The `isNull` guard lost a race, or the record went away.
          throw new UserSafeActionError(
            "That slot was just filled — reload and try again.",
          );
        }
      } catch (error) {
        // Third layer of the double-click defence, after the pre-read and the
        // `isNull` guard: two records claiming the same folder at once.
        if (isUniqueViolation(error, target.uniqueConstraint)) {
          throw new UserSafeActionError(
            "That folder is already linked to another record.",
          );
        }
        throw error;
      }

      target.revalidate(recordId);

      return { folderId: folder.id, folderName: folder.name };
    },
  );
