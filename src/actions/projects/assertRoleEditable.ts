import "server-only";

import { eq } from "drizzle-orm";
import type { db } from "@/lib/db/db";
import { projectRoles } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";

/** `db` or a transaction handle. */
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type EditableRole = {
  id: string;
  projectId: string;
  staffId: string | null;
};

/**
 * The single business guard for editing a role from an opportunity's planner:
 * you may only edit/delete a role that is **tentative** and **tagged with this
 * opportunity**. Confirmed (won) roles are locked, and roles from other
 * opportunities are read-only in this drawer. The RBAC gate is `projects.edit`
 * (in each action's metadata); this is the data-integrity invariant on top,
 * mirroring `assertOpportunityTransitionAllowed`. Returns the loaded role for
 * reuse. Throws `UserSafeActionError` on any violation.
 */
export async function assertRoleEditable(
  exec: Executor,
  roleId: string,
  opportunityId: string,
): Promise<EditableRole> {
  const [role] = await exec
    .select({
      id: projectRoles.id,
      projectId: projectRoles.projectId,
      staffId: projectRoles.staffId,
      status: projectRoles.status,
      opportunityId: projectRoles.opportunityId,
    })
    .from(projectRoles)
    .where(eq(projectRoles.id, roleId))
    .limit(1);

  if (!role) {
    throw new UserSafeActionError("That role no longer exists.");
  }
  if (role.opportunityId !== opportunityId) {
    throw new UserSafeActionError(
      "You can only edit roles you added for this opportunity.",
    );
  }
  if (role.status !== "tentative") {
    throw new UserSafeActionError(
      "This role is confirmed and can no longer be edited.",
    );
  }

  return { id: role.id, projectId: role.projectId, staffId: role.staffId };
}
