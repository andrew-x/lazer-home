import "server-only";

import { eq } from "drizzle-orm";
import type { ActionAuthorize } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { userHasPermission } from "@/lib/permissions";

/**
 * Can this user edit the given staff member's profile? The single decision point
 * for staff edits.
 *
 * Rule: a user may always edit their OWN linked profile; editing anyone else's
 * requires the `staff.edit` permission (manager/admin). This closes ADR 0012.
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
  const [own] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.userId, user.id))
    .limit(1);

  return own?.id === targetStaffId;
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
