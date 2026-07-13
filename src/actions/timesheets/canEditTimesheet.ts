import "server-only";

import { eq } from "drizzle-orm";
import type { ActionAuthorize } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { userHasPermission } from "@/lib/permissions";
import { isWithinEditWindow } from "@/lib/timesheet-week";

/**
 * Can this user edit the given week's timesheet? The single decision point for
 * timesheet writes (save / submit / reopen).
 *
 * Rule (mirrors `canEditStaff`, plus a time window):
 * - `timesheets.edit` (manager/admin) grants editing ANY timesheet, bypassing
 *   both ownership and the time window — short-circuits before the DB.
 * - Otherwise the target must be the caller's OWN linked staff record AND the
 *   week must be within the ±1-week edit window (last / this / next week).
 *
 * Used as a UI affordance (the page renders inputs only when true) and as the
 * basis for the server-side `authorizeTimesheetEdit` gate. The gate is the real
 * boundary — never the UI check alone.
 */
export async function canEditTimesheet(
  user: { id: string; role?: string | null },
  target: { staffId: string; weekStartDate: string },
): Promise<boolean> {
  if (userHasPermission(user, { timesheets: ["edit"] })) return true;

  // A normal user is confined to their own record within the edit window.
  if (!isWithinEditWindow(target.weekStartDate)) return false;

  const [own] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.userId, user.id))
    .limit(1);

  return own?.id === target.staffId;
}

/**
 * Action `authorize` hook for timesheet writes: gates on the input's `staffId` +
 * `weekStartDate`. Wire with `metadata({ authorize: authorizeTimesheetEdit })` —
 * `secureActionClient` runs it before the body. Any action using it must take
 * `staffId: string` and `weekStartDate: string` in its input.
 */
export const authorizeTimesheetEdit: ActionAuthorize = async ({
  user,
  clientInput,
}) => {
  const { staffId, weekStartDate } = clientInput as {
    staffId?: unknown;
    weekStartDate?: unknown;
  };
  if (
    typeof staffId !== "string" ||
    typeof weekStartDate !== "string" ||
    !(await canEditTimesheet(user, { staffId, weekStartDate }))
  ) {
    throw new UserSafeActionError("You don't have permission to do that.");
  }
};
