"use server";

import { secureActionClient } from "@/lib/core/action";
import { logger } from "@/lib/core/logger";
import {
  buildDriveFolderName,
  driveFolderNameIsTaken,
  suggestFreeDriveFolderName,
} from "@/lib/drive/folder";
import { authorizeDriveFolder } from "./authorizeDriveFolder";
import {
  driveListFolderNames,
  findParentFolder,
  isDriveConfigured,
} from "./driveApi";
import { checkDriveFolderNameSchema } from "./driveFolder.schema";
import { getDriveAccessToken } from "./driveToken";

/**
 * What the dialog learns about a proposed name. `unknown` means the check could not
 * run, NOT that the name is bad — see the note on failing open below.
 */
export type DriveFolderNameCheck =
  | { status: "available" }
  | { status: "taken"; suggestion: string }
  | { status: "unknown" };

/**
 * Is this folder name free in the `Sales` / `Projects` parent?
 *
 * Fired when the create dialog opens and as the name is edited, so a collision is
 * visible *before* anyone clicks Create. The default name is the record's own,
 * which is precisely the name most likely to have been taken already by someone
 * creating the folder by hand — so without this the most common case would be a
 * click, a wait, and a refusal.
 *
 * **Advisory, not the enforcement.** `createDriveFolder` re-checks against a fresh
 * listing, because this answer is stale the moment it returns and two people can
 * be in the dialog at once. Two consequences follow, and both are deliberate:
 *
 * - **It fails OPEN.** Drive being unreachable, unconfigured, or the grant being
 *   missing all return `unknown`, which leaves the button enabled rather than
 *   blocking on a check that couldn't run. Blocking would be worse than useless:
 *   creation might have worked, and the person has no way to tell why it won't.
 * - **A `taken` answer is a warning, not a verdict** — it disables the button, but
 *   the server refusal is what actually prevents the duplicate.
 *
 * Gated by `authorizeDriveFolder`, the same capability as the create it precedes:
 * it discloses sibling folder names, so it belongs behind the same door.
 */
export const checkDriveFolderName = secureActionClient
  .metadata({
    action: "check-drive-folder-name",
    authorize: authorizeDriveFolder,
  })
  .inputSchema(checkDriveFolderNameSchema)
  .action(
    async ({
      parsedInput: { kind, name },
      ctx: { user },
    }): Promise<DriveFolderNameCheck> => {
      const requestedName = buildDriveFolderName(name);
      if (!requestedName || !isDriveConfigured()) return { status: "unknown" };

      const accessToken = await getDriveAccessToken(user.id);
      if (!accessToken) return { status: "unknown" };

      try {
        // `findParentFolder`, not `resolveParentFolder`: this must not create
        // anything. No parent yet means nothing can collide.
        const parentId = await findParentFolder(kind, accessToken);
        if (!parentId) return { status: "available" };

        const siblingNames = await driveListFolderNames(parentId, accessToken);

        if (!driveFolderNameIsTaken(requestedName, siblingNames)) {
          return { status: "available" };
        }

        return {
          status: "taken",
          // Offered, never applied — the dialog puts it behind a button so the
          // name that gets created is always one somebody chose.
          suggestion: suggestFreeDriveFolderName(requestedName, siblingNames),
        };
      } catch (error) {
        logger.warn("drive_folder_name_check_failed", {
          reason: error instanceof Error ? error.message : "unknown",
        });
        return { status: "unknown" };
      }
    },
  );
