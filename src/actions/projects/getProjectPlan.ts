import "server-only";

import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db/db";
import {
  companies,
  projectDeliveryManagers,
  projectRoles,
  projects,
  staff,
} from "@/lib/db/schema";
import {
  deriveProjectLinesOfBusiness,
  deriveProjectStatus,
} from "@/lib/projects/project-derived";
import type {
  ExternalAllocation,
  PlanProject,
  PlanRole,
} from "./getOpportunityPlan";

/**
 * The read behind the standalone project detail page: the project's meta plus
 * **every** role on it (across all opportunities) and the other-project
 * commitments of its staff, shaped for the same planner grid the opportunity's
 * Project-plan tab uses. Unlike {@link getOpportunityPlan} this is keyed by the
 * project id and carries the owning company (for the header); it has no
 * `editable`/`currentOpportunityId` notion — the detail page renders read-only.
 * Returns null when the project id is unknown, so the page can `notFound()`.
 */
export type ProjectDetailPlan = {
  project: PlanProject;
  /** The client this project delivers for — for the detail-page header link. */
  company: { id: string; name: string };
  /** Every role on the project, for the planner grid and the Roles table. */
  roles: PlanRole[];
  /** The overall span across all roles, or null when there are no roles. */
  timeline: { start: string; end: string } | null;
  roleCount: number;
  /** Other-project commitments of this project's staff, for the greyed blocks. */
  externalAllocations: ExternalAllocation[];
};

export async function getProjectPlan(
  projectId: string,
): Promise<ProjectDetailPlan | null> {
  const [projectRow] = await db
    .select({
      id: projects.id,
      name: projects.name,
      companyId: companies.id,
      companyName: companies.name,
    })
    .from(projects)
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!projectRow) return null;

  // The project's delivery managers, resolved to names for display.
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

  // The other-project commitments of everyone staffed here, so the planner can
  // grey them in behind this project's roles. Other projects only; same status
  // filter as the allocations grid.
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

  const project: PlanProject = {
    id: projectRow.id,
    name: projectRow.name,
    // Project status and lines of business are derived from its roles.
    status: deriveProjectStatus(roles.map((r) => r.status)),
    linesOfBusiness: deriveProjectLinesOfBusiness(
      roles.map((r) => r.lineOfBusiness),
    ),
    deliveryManagers,
  };

  return {
    project,
    company: { id: projectRow.companyId, name: projectRow.companyName },
    roles,
    timeline,
    roleCount: roles.length,
    externalAllocations,
  };
}
