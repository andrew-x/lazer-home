"use server";

import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { authorizeDriveFolder } from "./authorizeDriveFolder";
import { unlinkDriveFolderSchema } from "./driveFolder.schema";
import { DRIVE_FOLDER_TARGETS } from "./driveFolderLink";

/**
 * Detach a record from its Drive folder. **Clears our columns and nothing else** —
 * the folder and every file in it are untouched, which is what the confirmation
 * copy promises.
 *
 * In scope from day one rather than deferred, because it's the only escape hatch
 * for the ways a link goes bad: the wrong folder was linked, the folder was
 * deleted or moved out of the shared drive, or it was renamed into something the
 * stored snapshot no longer resembles. Without this, any of those is permanent.
 */
export const unlinkDriveFolder = secureActionClient
  .metadata({
    action: "unlink-drive-folder",
    authorize: authorizeDriveFolder,
  })
  .inputSchema(unlinkDriveFolderSchema)
  .action(async ({ parsedInput: { kind, recordId } }) => {
    const target = DRIVE_FOLDER_TARGETS[kind];

    const cleared = await target.unlink(recordId);
    if (!cleared) {
      throw new UserSafeActionError("That record no longer exists.");
    }

    target.revalidate(recordId);

    return { recordId };
  });
