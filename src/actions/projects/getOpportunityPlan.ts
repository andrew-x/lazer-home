import "server-only";

import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import { db } from "@/lib/db/db";
import {
  opportunities,
  projectDeliveryManagers,
  projectRoles,
  projects,
  staff,
} from "@/lib/db/schema";
import {
  deriveProjectLinesOfBusiness,
  deriveProjectStatus,
} from "@/lib/projects/project-derived";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";

/** One staffing line on the opportunity's project, shaped for the planner. */
export type PlanRole = {
  id: string;
  staffId: string | null;
  staffName: string | null;
  lineOfBusiness: LineOfBusiness;
  description: string | null;
  roleType: ProjectRoleType;
  status: ProjectRoleStatus;
  // The opportunity that created the role — the planner greys roles from other
  // opportunities and lets you edit only this opportunity's tentative ones.
  opportunityId: string | null;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
};

/**
 * A staffing line one of this project's people holds on **another** project,
 * shaped for the planner. Assigning someone here surfaces their commitments
 * elsewhere (greyed) so an over-allocation is visible while planning this deal.
 */
export type ExternalAllocation = {
  staffId: string;
  roleId: string;
  projectName: string;
  roleType: ProjectRoleType;
  status: ProjectRoleStatus;
  lineOfBusiness: LineOfBusiness;
  description: string | null;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
};

export type PlanProject = {
  id: string;
  name: string;
  /** Derived from the project's roles (see `project-derived.ts`). */
  status: ProjectRoleStatus;
  /** The distinct lines of business across the project's roles. */
  linesOfBusiness: LineOfBusiness[];
  /** The staff who run this project, resolved for display and editing. */
  deliveryManagers: { id: string; name: string }[];
};

export type OpportunityPlan = {
  /** The project delivering this opportunity, or null if none is linked yet. */
  project: PlanProject | null;
  /** Every role on that project (all opportunities), for the planner grid. */
  roles: PlanRole[];
  /** The overall span across all roles, or null when there are no roles. */
  timeline: { start: string; end: string } | null;
  roleCount: number;
  /**
   * Roles the staffed people here hold on **other** projects (tentative or
   * confirmed), for the greyed "other commitments" blocks. Empty when no one is
   * staffed yet.
   */
  externalAllocations: ExternalAllocation[];
};

/**
 * The planner read for an opportunity's associated project: project meta plus
 * **every** role on it (across all opportunities), each carrying its status and
 * originating opportunity so the client can render this opportunity's tentative
 * roles as editable and everything else (confirmed, or other opportunities')
 * greyed. Returns null only if the opportunity itself is unknown; an opportunity
 * with no project returns an empty plan. Reads go through the actions layer.
 */
export async function getOpportunityPlan(
  opportunityId: string,
): Promise<OpportunityPlan | null> {
  const [opportunity] = await db
    .select({ projectId: opportunities.projectId })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);

  if (!opportunity) return null;
  if (!opportunity.projectId) {
    return {
      project: null,
      roles: [],
      timeline: null,
      roleCount: 0,
      externalAllocations: [],
    };
  }

  const [projectRow] = await db
    .select({
      id: projects.id,
      name: projects.name,
    })
    .from(projects)
    .where(eq(projects.id, opportunity.projectId))
    .limit(1);

  if (!projectRow) {
    // The FK guarantees this shouldn't happen, but treat a vanished project as
    // an empty plan rather than throwing.
    return {
      project: null,
      roles: [],
      timeline: null,
      roleCount: 0,
      externalAllocations: [],
    };
  }

  // The project's delivery managers, resolved to names for display/editing.
  const deliveryManagers = await db
    .select({ id: staff.id, name: staff.name })
    .from(projectDeliveryManagers)
    .innerJoin(staff, eq(projectDeliveryManagers.staffId, staff.id))
    .where(eq(projectDeliveryManagers.projectId, projectRow.id))
    .orderBy(asc(staff.name));

  // All roles for the project in one query. Left join staff (staffId is
  // nullable — placeholders survive).
  const roles: PlanRole[] = await db
    .select({
      id: projectRoles.id,
      staffId: projectRoles.staffId,
      staffName: staff.name,
      lineOfBusiness: projectRoles.lineOfBusiness,
      description: projectRoles.description,
      roleType: projectRoles.roleType,
      status: projectRoles.status,
      opportunityId: projectRoles.opportunityId,
      startDate: projectRoles.startDate,
      endDate: projectRoles.endDate,
      hoursPerDay: projectRoles.hoursPerDay,
    })
    .from(projectRoles)
    .leftJoin(staff, eq(projectRoles.staffId, staff.id))
    .where(eq(projectRoles.projectId, projectRow.id))
    .orderBy(asc(projectRoles.startDate));

  // The other-project commitments of everyone staffed on this project, so the
  // planner can grey them in behind this deal's roles. Same status filter as the
  // allocations grid; other projects only (same-project roles are their own rows).
  const staffIds = [
    ...new Set(roles.flatMap((r) => (r.staffId ? [r.staffId] : []))),
  ];
  const externalAllocations: ExternalAllocation[] = staffIds.length
    ? (
        await db
          .select({
            staffId: projectRoles.staffId,
            roleId: projectRoles.id,
            projectName: projects.name,
            roleType: projectRoles.roleType,
            status: projectRoles.status,
            lineOfBusiness: projectRoles.lineOfBusiness,
            description: projectRoles.description,
            startDate: projectRoles.startDate,
            endDate: projectRoles.endDate,
            hoursPerDay: projectRoles.hoursPerDay,
          })
          .from(projectRoles)
          .innerJoin(projects, eq(projectRoles.projectId, projects.id))
          .where(
            and(
              inArray(projectRoles.staffId, staffIds),
              ne(projectRoles.projectId, projectRow.id),
              inArray(projectRoles.status, ["tentative", "confirmed"]),
            ),
          )
          .orderBy(asc(projectRoles.startDate))
      ).map((r) => ({ ...r, staffId: r.staffId as string }))
    : [];

  // Overall span — ISO date strings sort lexically, so min/max are string
  // reductions. Null when the project has no roles yet.
  let timeline: { start: string; end: string } | null = null;
  for (const role of roles) {
    if (!timeline) {
      timeline = { start: role.startDate, end: role.endDate };
      continue;
    }
    if (role.startDate < timeline.start) timeline.start = role.startDate;
    if (role.endDate > timeline.end) timeline.end = role.endDate;
  }

  return {
    project: {
      ...projectRow,
      // Project status and lines of business are derived from its roles.
      status: deriveProjectStatus(roles.map((r) => r.status)),
      linesOfBusiness: deriveProjectLinesOfBusiness(
        roles.map((r) => r.lineOfBusiness),
      ),
      deliveryManagers,
    },
    roles,
    timeline,
    roleCount: roles.length,
    externalAllocations,
  };
}
