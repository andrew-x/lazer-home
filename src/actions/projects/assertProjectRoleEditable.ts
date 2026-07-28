import "server-only";

import { eq } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { UserSafeActionError } from "@/lib/core/errors";
import type { db } from "@/lib/db/db";
import { projectRoles } from "@/lib/db/schema";

/** `db` or a transaction handle. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type EditableRole = {
  id: string;
  projectId: string;
  staffId: string | null;
  /** The opportunity this role came from, if any — null for a standalone role. */
  opportunityId: string | null;
};

/**
 * The business guard for editing a role from the **project detail page**: the role
 * must exist and belong to this project. That's the whole invariant — no status
 * check, no opportunity check.
 *
 * ## Why this is laxer than {@link assertRoleEditable}, and why that isn't a bypass
 *
 * The two guards serve two different editors of the same rows:
 *
 * - `assertRoleEditable` is the **deal-side** guard, for an opportunity's planner.
 *   There, only this opportunity's own still-tentative lines are yours to change —
 *   a deal drawer must not reach into another deal's plan, and once a deal is won
 *   its roles are a committed plan, not a draft.
 * - This is the **delivery-side** guard, for the project a team is actually
 *   staffing. A live project's roles are `confirmed` precisely *because* the deal
 *   was won, and delivery legitimately needs to re-date them, move hours, and swap
 *   assignees. Scoping by `projectId` is the correct containment here: you can only
 *   touch roles on the project you're looking at.
 *
 * Both paths carry the same RBAC gate (`projects.edit`) in their action metadata —
 * this is a data-integrity invariant, not an access-control check, and neither
 * guard is weakened by the other's existence. Precedent for a non-opportunity-
 * scoped role write predates both: `allocateStaffToRole` re-dates and staffs
 * confirmed open roles keyed by `roleId` alone.
 *
 * **Known consequence, accepted deliberately:** editing or deleting a role that
 * carries an `opportunityId` also changes that opportunity's plan, and removing a
 * role can shift the project's *derived* status (see `deriveProjectStatus`). The
 * returned `opportunityId` is there so callers can warn about exactly that before
 * a destructive edit.
 *
 * Returns the loaded role for reuse. Throws `UserSafeActionError` on any violation.
 */
export async function assertProjectRoleEditable(
  exec: Executor,
  roleId: string,
  projectId: string,
): Promise<EditableRole> {
  const roleRows = await exec
    .select({
      id: projectRoles.id,
      projectId: projectRoles.projectId,
      staffId: projectRoles.staffId,
      opportunityId: projectRoles.opportunityId,
    })
    .from(projectRoles)
    .where(eq(projectRoles.id, roleId))
    .limit(1);

  assertRowExists(roleRows, "role");
  const [role] = roleRows;
  if (role.projectId !== projectId) {
    throw new UserSafeActionError(
      "You can only edit roles that belong to this project.",
    );
  }

  return role;
}
