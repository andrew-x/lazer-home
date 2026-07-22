import "server-only";

import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { CRM_PAGE_SIZE, clampPage, type Page } from "@/lib/core/pagination";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
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
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";

export type ProjectRow = {
  id: string;
  name: string;
  /** Derived from the project's roles (see `project-derived.ts`). */
  status: ProjectRoleStatus;
  /** The distinct lines of business across the project's roles. */
  linesOfBusiness: LineOfBusiness[];
  companyId: string;
  companyName: string;
  deliveryManagerNames: string[];
  roleCount: number;
};

/**
 * One page of projects, ordered by creation (newest first), with the company
 * name resolved via a join, delivery-manager names resolved via a single grouped
 * follow-up query, and role counts via a grouped count (no N+1). `page` is
 * clamped into range.
 */
export async function getProjectsPage(
  page = 1,
  pageSize = CRM_PAGE_SIZE,
): Promise<Page<ProjectRow>> {
  const [{ total }] = await db.select({ total: count() }).from(projects);
  const { pageCount, safePage } = clampPage(total, page, pageSize);

  const baseRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      companyId: projects.companyId,
      companyName: companies.name,
    })
    .from(projects)
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .orderBy(desc(projects.createdAt))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  const managersByProject = new Map<string, string[]>();
  // Role statuses and lines of business per project, for the derived fields.
  const roleStatusesByProject = new Map<string, ProjectRoleStatus[]>();
  const roleLobsByProject = new Map<string, LineOfBusiness[]>();

  if (baseRows.length > 0) {
    const pageIds = baseRows.map((r) => r.id);

    // Delivery-manager names for just this page's projects, in one query.
    const managerRows = await db
      .select({
        projectId: projectDeliveryManagers.projectId,
        name: staff.name,
      })
      .from(projectDeliveryManagers)
      .innerJoin(staff, eq(projectDeliveryManagers.staffId, staff.id))
      .where(inArray(projectDeliveryManagers.projectId, pageIds))
      .orderBy(asc(staff.name));

    for (const { projectId, name } of managerRows) {
      const list = managersByProject.get(projectId) ?? [];
      list.push(name);
      managersByProject.set(projectId, list);
    }

    // Role status + line of business for this page's projects, in one query —
    // the raw material for the derived project status and lines of business.
    const roleRows = await db
      .select({
        projectId: projectRoles.projectId,
        status: projectRoles.status,
        lineOfBusiness: projectRoles.lineOfBusiness,
      })
      .from(projectRoles)
      .where(inArray(projectRoles.projectId, pageIds));

    for (const { projectId, status, lineOfBusiness } of roleRows) {
      const statuses = roleStatusesByProject.get(projectId) ?? [];
      statuses.push(status);
      roleStatusesByProject.set(projectId, statuses);

      const lobs = roleLobsByProject.get(projectId) ?? [];
      lobs.push(lineOfBusiness);
      roleLobsByProject.set(projectId, lobs);
    }
  }

  const rows: ProjectRow[] = baseRows.map((r) => {
    const statuses = roleStatusesByProject.get(r.id) ?? [];
    return {
      ...r,
      status: deriveProjectStatus(statuses),
      linesOfBusiness: deriveProjectLinesOfBusiness(
        roleLobsByProject.get(r.id) ?? [],
      ),
      deliveryManagerNames: managersByProject.get(r.id) ?? [],
      roleCount: statuses.length,
    };
  });

  return { rows, total, page: safePage, pageSize, pageCount };
}
