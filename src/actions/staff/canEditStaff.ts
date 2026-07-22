import "server-only";

import { userHasPermission } from "@/lib/auth/permissions";
import type { ActionAuthorize } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { ownStaffId } from "./ownStaffId";

/**
 * Can this user edit the given staff member's profile? The single decision point
 * for staff edits.
 *
 * Rule: a user may always edit their OWN linked profile; editing anyone else's
 * requires the `staff.edit` permission (manager/admin). See ADR 0014.
 *
 * Used as a UI affordance (pages render edit controls only when true) and as the
 * basis for the server-side `authorizeStaffEdit` gate below. The server gate is
 * the real boundary — never the UI check alone.
 */
export async function canEditStaff(
  user: { id: string; role?: string | null },
  targetStaffId: string,
): Promise<boolean> {
  // staff.edit grants editing any profile — short-circuit before touching the db.
  if (userHasPermission(user, { staff: ["edit"] })) return true;

  // Otherwise the target must be the caller's own linked staff record.
  return (await ownStaffId(user.id)) === targetStaffId;
}

/**
 * Action `authorize` hook (see {@link ActionAuthorize}) for staff-profile edits:
 * gates on the input's `staffId`. Wire it with
 * `metadata({ authorize: authorizeStaffEdit })` — `secureActionClient` runs it
 * before the body. Any action using it must take a `staffId: string` in its input.
 */
export const authorizeStaffEdit: ActionAuthorize = async ({
  user,
  clientInput,
}) => {
  const staffId = (clientInput as { staffId?: unknown }).staffId;
  if (typeof staffId !== "string" || !(await canEditStaff(user, staffId))) {
    throw new UserSafeActionError("You don't have permission to do that.");
  }
};
