import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import {
  opportunities,
  projectDeliveryManagers,
  projectRoles,
  projects,
  staff,
} from "@/lib/db/schema";
import type { LineOfBusiness } from "@/lib/line-of-business";
import type { ProjectRoleStatus } from "@/lib/project-role-status";
import type { ProjectRoleType } from "@/lib/project-role-type";
import type { ProjectStatus } from "@/lib/project-status";

/** One staffing line on the opportunity's project, shaped for the planner. */
export type PlanRole = {
  id: string;
  staffId: string | null;
  staffName: string | null;
  name: string | null;
  roleType: ProjectRoleType;
  status: ProjectRoleStatus;
  // The opportunity that created the role — the planner greys roles from other
  // opportunities and lets you edit only this opportunity's tentative ones.
  opportunityId: string | null;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
};

export type PlanProject = {
  id: string;
  name: string;
  status: ProjectStatus;
  lineOfBusiness: LineOfBusiness;
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
    return { project: null, roles: [], timeline: null, roleCount: 0 };
  }

  const [projectRow] = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      lineOfBusiness: projects.lineOfBusiness,
    })
    .from(projects)
    .where(eq(projects.id, opportunity.projectId))
    .limit(1);

  if (!projectRow) {
    // The FK guarantees this shouldn't happen, but treat a vanished project as
    // an empty plan rather than throwing.
    return { project: null, roles: [], timeline: null, roleCount: 0 };
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
      name: projectRoles.name,
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
    project: { ...projectRow, deliveryManagers },
    roles,
    timeline,
    roleCount: roles.length,
  };
}
