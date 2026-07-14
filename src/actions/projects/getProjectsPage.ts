import "server-only";

import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/db";
import {
  companies,
  projectDeliveryManagers,
  projectRoles,
  projects,
  staff,
} from "@/lib/db/schema";
import { CRM_PAGE_SIZE, clampPage, type Page } from "@/lib/pagination";
import type { ProjectStatus } from "@/lib/project-status";

export type ProjectRow = {
  id: string;
  name: string;
  status: ProjectStatus;
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
      status: projects.status,
      companyId: projects.companyId,
      companyName: companies.name,
    })
    .from(projects)
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .orderBy(desc(projects.createdAt))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  const managersByProject = new Map<string, string[]>();
  const roleCountByProject = new Map<string, number>();

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

    // Role counts per project, in one grouped query.
    const roleCounts = await db
      .select({
        projectId: projectRoles.projectId,
        roleCount: count(),
      })
      .from(projectRoles)
      .where(inArray(projectRoles.projectId, pageIds))
      .groupBy(projectRoles.projectId);

    for (const { projectId, roleCount } of roleCounts) {
      roleCountByProject.set(projectId, roleCount);
    }
  }

  const rows: ProjectRow[] = baseRows.map((r) => ({
    ...r,
    deliveryManagerNames: managersByProject.get(r.id) ?? [],
    roleCount: roleCountByProject.get(r.id) ?? 0,
  }));

  return { rows, total, page: safePage, pageSize, pageCount };
}
