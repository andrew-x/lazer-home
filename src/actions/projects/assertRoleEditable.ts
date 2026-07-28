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
};

/**
 * The business guard for editing a role from an opportunity's planner — the
 * **deal-side** guard: you may only edit/delete a role that is **tentative** and
 * **tagged with this opportunity**. Confirmed (won) roles are locked, and roles
 * from other opportunities are read-only in this drawer. The RBAC gate is
 * `projects.edit` (in each action's metadata); this is the data-integrity
 * invariant on top, mirroring `assertOpportunityTransitionAllowed`. Returns the
 * loaded role for reuse. Throws `UserSafeActionError` on any violation.
 *
 * **There is a laxer sibling — that is by design, not a bypass.** The project
 * detail page edits the same rows through `assertProjectRoleEditable`, which scopes
 * by `projectId` and permits confirmed roles, because delivery has to adjust the
 * staffing of a won engagement. Read that guard's docstring for the full rationale
 * before assuming either one is a hole. Keep this one strict: opportunity-scoped
 * actions must not relax it.
 */
export async function assertRoleEditable(
  exec: Executor,
  roleId: string,
  opportunityId: string,
): Promise<EditableRole> {
  const roleRows = await exec
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

  assertRowExists(roleRows, "role");
  const [role] = roleRows;
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
