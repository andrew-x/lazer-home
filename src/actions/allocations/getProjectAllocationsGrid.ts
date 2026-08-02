import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import {
  LINE_OF_BUSINESS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import { db } from "@/lib/db/db";
import { companies, projectRoles, projects, staff } from "@/lib/db/schema";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import {
  PROJECT_ROLE_TYPES,
  type ProjectRoleType,
} from "@/lib/projects/project-role-type";

/**
 * Filter dimensions for the by-project planner. Unlike the staff view — which
 * filters *people* and so borrows the staff directory's dimensions — this view
 * filters *roles*, so the options are the role's own enums. Re-exported here so
 * the page passes them as props without importing the Drizzle schema itself
 * (the actions layer owns all `@/lib/db` access).
 */
export const projectAllocationsFilterOptions = {
  lineOfBusiness: LINE_OF_BUSINESS,
  roleType: PROJECT_ROLE_TYPES,
};

/**
 * One live project-role line — the by-project view's unit of work. `staffId` is
 * **null for an open position**, which is the whole point of this read: the
 * staff-row planner (`getAllocationsGrid`) filters those out because it has no
 * row to hang them on, so an unstaffed role is invisible there.
 */
export type ProjectAllocationRoleRow = {
  id: string;
  projectId: string;
  projectName: string;
  companyName: string;
  roleType: ProjectRoleType;
  status: ProjectRoleStatus;
  lineOfBusiness: LineOfBusiness;
  description: string | null;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
  /** Null ⇒ this role is an open position. */
  staffId: string | null;
  staffName: string | null;
};

export type ProjectAllocationsGridData = {
  roles: ProjectAllocationRoleRow[];
  /** Whether the viewer may staff an open role (`projects.edit`). */
  canAllocate: boolean;
};

/**
 * The raw material for the by-project allocations planner: every live project
 * role, staffed or open, with its project and client. Bucketing, percentages and
 * the per-project rollup are pure client math
 * (`@/lib/allocations/project-allocations-grid`), so this read stays a simple
 * projection — the same division of labour as {@link getAllocationsGrid}.
 *
 * Only the two live planning states are returned: a `paused`/`cancelled` role
 * isn't an allocation, matching the staff view's definition.
 *
 * No metadata gate: the `(app)` layout guarantees the viewer is signed in, and
 * project-role reads are open by design — this page is visible to everyone.
 * Nothing here is narrower than what `/projects/[id]` already shows.
 */
export async function getProjectAllocationsGrid(): Promise<ProjectAllocationsGridData> {
  const roleRows = await db
    .select({
      id: projectRoles.id,
      projectId: projectRoles.projectId,
      projectName: projects.name,
      companyName: companies.name,
      roleType: projectRoles.roleType,
      status: projectRoles.status,
      lineOfBusiness: projectRoles.lineOfBusiness,
      description: projectRoles.description,
      startDate: projectRoles.startDate,
      endDate: projectRoles.endDate,
      hoursPerDay: projectRoles.hoursPerDay,
      staffId: projectRoles.staffId,
      // Left-joined: an open position has no person, and dropping those rows is
      // exactly the bug this view exists to fix.
      staffName: staff.name,
    })
    .from(projectRoles)
    .innerJoin(projects, eq(projectRoles.projectId, projects.id))
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .leftJoin(staff, eq(projectRoles.staffId, staff.id))
    .where(inArray(projectRoles.status, ["tentative", "confirmed"]))
    .orderBy(asc(projects.name), asc(projectRoles.startDate));

  // Staffing an open role writes a project role, so gate the clickable
  // "Unallocated" block (and its dialog) on `projects.edit` — the same
  // capability `allocateStaffToRole` itself enforces.
  const currentUser = await getCurrentUser();
  const canAllocate = currentUser
    ? userHasPermission(currentUser, { projects: ["edit"] })
    : false;

  return { roles: roleRows, canAllocate };
}
