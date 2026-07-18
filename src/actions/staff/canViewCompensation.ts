import "server-only";

import { userHasPermission } from "@/lib/permissions";
import { ownStaffId } from "./ownStaffId";

/**
 * Can this user see the given staff member's compensation? The single decision
 * point for comp visibility.
 *
 * Rule: a user may always see their OWN compensation; seeing anyone else's
 * requires the `staff.viewCompensation` permission (finance/manager/admin).
 *
 * Used both as a UI affordance (pages render the comp card / history entries only
 * when true) and — because history renders in a client component — as the gate
 * on which comp data leaves the server at all (see getStaffHistory).
 */
export async function canViewCompensation(
  user: { id: string; role?: string | null },
  targetStaffId: string,
): Promise<boolean> {
  // The permission grants viewing any profile's comp — short-circuit before the db.
  if (userHasPermission(user, { staff: ["viewCompensation"] })) return true;

  // Otherwise the target must be the caller's own linked staff record.
  return (await ownStaffId(user.id)) === targetStaffId;
}
