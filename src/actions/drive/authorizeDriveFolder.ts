import "server-only";

import { requirePermission } from "@/lib/auth/permissions";
import type { ActionAuthorize } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { driveFolderKindSchema } from "./driveFolder.schema";
import { DRIVE_FOLDER_TARGETS } from "./driveFolderLink";

/**
 * The gate for the Drive folder LINK actions: the capability follows the record
 * being written. A sales folder is a column on `opportunities`, so it needs
 * `crm.edit`; a project folder is a column on `projects`, so it needs
 * `projects.edit`.
 *
 * Why this is an `authorize` hook and not a static `metadata.permission`: the two
 * capabilities are *disjoint* in the role matrix — `sales` holds only `crm.edit`,
 * `delivery-manager` only `projects.edit` — so no single static capability covers
 * both kinds without granting a role access it shouldn't have. This is exactly
 * the input-dependent case `ActionAuthorize` exists for, and it needs no new
 * capability, so the permission matrix is untouched. (Same call as
 * `authorizeSlackChannel`; see docs/decisions/0067 and 0071.)
 *
 * Note what this does NOT gate: browsing a folder and adding files to it. Those
 * carry no capability, deliberately — they run on the viewer's own Google token,
 * so Google enforces shared-drive membership, and they can only surface or write
 * what that person could already do in Drive's own UI. Gating them here would be
 * theatre. See docs/decisions/0071.
 *
 * `clientInput` is raw and pre-validation, so `kind` is parsed here rather than
 * trusted. An unparseable kind is **denied**, not skipped: a hook that returns
 * early when it can't read its own discriminant is a bypass, since the body would
 * then run ungated.
 */
export const authorizeDriveFolder: ActionAuthorize = ({
  user,
  clientInput,
}) => {
  const kind = driveFolderKindSchema.safeParse(
    (clientInput as { kind?: unknown } | null)?.kind,
  );
  if (!kind.success) {
    throw new UserSafeActionError("You don't have permission to do that.");
  }
  requirePermission(user, DRIVE_FOLDER_TARGETS[kind.data].permission);
};
