"use server";

import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { authorizeDriveFolder } from "./authorizeDriveFolder";
import { createRecordFolder } from "./createRecordFolder";
import { isDriveConfigured } from "./driveApi";
import { createDriveFolderSchema } from "./driveFolder.schema";
import { requireDriveAccessToken } from "./driveToken";

/**
 * Create this record's folder in the Lazer Home shared drive and link it.
 *
 * The work lives in `createRecordFolder`, because `assignTranscript` needs the same
 * create-and-link on the way to filing a transcript into a record that has no
 * folder yet, and an action cannot call another action. **Its step order is the
 * design** (precheck → resolve parent → refuse a name collision → create → link
 * under the `isNull` guard → compensating delete); read the note there before
 * changing anything about it.
 *
 * Gated by `authorizeDriveFolder`: the capability follows the record being written,
 * so `crm.edit` for a sales folder and `projects.edit` for a project folder. See
 * docs/decisions/0071 §7.
 */
export const createDriveFolder = secureActionClient
  .metadata({
    action: "create-drive-folder",
    authorize: authorizeDriveFolder,
  })
  .inputSchema(createDriveFolderSchema)
  .action(async ({ parsedInput: { kind, recordId, name }, ctx: { user } }) => {
    if (!isDriveConfigured()) {
      throw new UserSafeActionError("Google Drive isn't connected.");
    }

    const accessToken = await requireDriveAccessToken(user.id);
    return createRecordFolder(kind, recordId, name, accessToken);
  });
