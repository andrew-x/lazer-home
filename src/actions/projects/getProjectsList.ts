import "server-only";

import {
  and,
  asc,
  count,
  eq,
  exists,
  ilike,
  inArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
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
  type ProjectStatusBucket,
} from "@/lib/projects/project-derived";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import {
  derivedStatusCondition,
  latestRoleEndDate,
} from "@/lib/projects/project-status-sql";
import { currentDay } from "@/lib/timesheets/timesheet-week";

export type ProjectListItem = {
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
  /** Earliest role start date ("YYYY-MM-DD"); null when the project has no roles. */
  startDate: string | null;
  /** Latest role end date ("YYYY-MM-DD"); null when the project has no roles. */
  endDate: string | null;
};

/** Optional filters shared by the list views — name/company search, a line of
 * business, and a delivery manager (staff id). */
export type ProjectsListFilters = {
  /** Case-insensitive substring match on project or company name. */
  query?: string;
  lineOfBusiness?: LineOfBusiness;
  /** A `staff.id`; matches projects this person is a delivery manager on. */
  deliveryManagerId?: string;
};

/** A delivery-manager option for the list filter: a staff id + display name. */
export type DeliveryManagerOption = { id: string; name: string };

/** How the paginated list is ordered. */
export type ProjectsListOrder = "name" | "endDate";

/**
 * Order clauses for the row query. `endDate` sorts by the project's latest role
 * end date (`latestRoleEndDate` — a correlated `max`, since the date range is
 * derived, not a column) newest first, projects without roles last; `name` is the
 * alphabetical default. Name always breaks ties so paging stays stable.
 */
function orderClauses(order: ProjectsListOrder): SQL[] {
  if (order === "endDate") {
    return [sql`${latestRoleEndDate} desc nulls last`, asc(projects.name)];
  }
  return [asc(projects.name)];
}

/**
 * The combined `where` for a set of status buckets + the optional filters. Reads
 * the clock once per call for the bucket predicate — the active/past split turns
 * on today's date (see `derivedStatusCondition`).
 */
function projectsWhere(
  buckets: ProjectStatusBucket[],
  filters: ProjectsListFilters,
): SQL | undefined {
  const conditions: SQL[] = [];

  const bucketCondition = derivedStatusCondition(buckets, currentDay());
  if (bucketCondition) conditions.push(bucketCondition);

  if (filters.lineOfBusiness) {
    // A project belongs to a line of business iff one of its roles does.
    conditions.push(
      exists(
        db
          .select({ n: sql`1` })
          .from(projectRoles)
          .where(
            and(
              eq(projectRoles.projectId, projects.id),
              eq(projectRoles.lineOfBusiness, filters.lineOfBusiness),
            ),
          ),
      ),
    );
  }

  if (filters.deliveryManagerId) {
    // A project matches iff this staff member is one of its delivery managers.
    conditions.push(
      exists(
        db
          .select({ n: sql`1` })
          .from(projectDeliveryManagers)
          .where(
            and(
              eq(projectDeliveryManagers.projectId, projects.id),
              eq(projectDeliveryManagers.staffId, filters.deliveryManagerId),
            ),
          ),
      ),
    );
  }

  const query = filters.query?.trim();
  if (query) {
    const term = `%${query}%`;
    const nameMatch = or(
      ilike(projects.name, term),
      ilike(companies.name, term),
    );
    if (nameMatch) conditions.push(nameMatch);
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * The staff who are a delivery manager on at least one project, ordered by name
 * — the option set for the list's delivery-manager filter. Distinct so a person
 * managing several projects appears once.
 */
export async function getDeliveryManagerOptions(): Promise<
  DeliveryManagerOption[]
> {
  return db
    .selectDistinct({ id: staff.id, name: staff.name })
    .from(projectDeliveryManagers)
    .innerJoin(staff, eq(projectDeliveryManagers.staffId, staff.id))
    .orderBy(asc(staff.name));
}

/**
 * Assemble full `ProjectListItem`s for the given base rows: one grouped
 * delivery-manager query and one role query (scoped to these ids), then derive
 * status, lines of business, role count, and the date range in JS. No N+1 — two
 * follow-up queries regardless of row count. Preserves the input order.
 */
async function assembleRows(
  baseRows: {
    id: string;
    name: string;
    companyId: string;
    companyName: string;
  }[],
): Promise<ProjectListItem[]> {
  if (baseRows.length === 0) return [];
  const ids = baseRows.map((row) => row.id);

  const managersByProject = new Map<string, string[]>();
  const roleStatusesByProject = new Map<string, ProjectRoleStatus[]>();
  const roleLobsByProject = new Map<string, LineOfBusiness[]>();
  const startDateByProject = new Map<string, string>();
  const endDateByProject = new Map<string, string>();

  const managerRows = await db
    .select({ projectId: projectDeliveryManagers.projectId, name: staff.name })
    .from(projectDeliveryManagers)
    .innerJoin(staff, eq(projectDeliveryManagers.staffId, staff.id))
    .where(inArray(projectDeliveryManagers.projectId, ids))
    .orderBy(asc(staff.name));

  for (const { projectId, name } of managerRows) {
    const list = managersByProject.get(projectId) ?? [];
    list.push(name);
    managersByProject.set(projectId, list);
  }

  const roleRows = await db
    .select({
      projectId: projectRoles.projectId,
      status: projectRoles.status,
      lineOfBusiness: projectRoles.lineOfBusiness,
      startDate: projectRoles.startDate,
      endDate: projectRoles.endDate,
    })
    .from(projectRoles)
    .where(inArray(projectRoles.projectId, ids));

  for (const row of roleRows) {
    const statuses = roleStatusesByProject.get(row.projectId) ?? [];
    statuses.push(row.status);
    roleStatusesByProject.set(row.projectId, statuses);

    const lobs = roleLobsByProject.get(row.projectId) ?? [];
    lobs.push(row.lineOfBusiness);
    roleLobsByProject.set(row.projectId, lobs);

    // "YYYY-MM-DD" is zero-padded, so lexicographic min/max === chronological.
    const currentStart = startDateByProject.get(row.projectId);
    if (currentStart === undefined || row.startDate < currentStart) {
      startDateByProject.set(row.projectId, row.startDate);
    }
    const currentEnd = endDateByProject.get(row.projectId);
    if (currentEnd === undefined || row.endDate > currentEnd) {
      endDateByProject.set(row.projectId, row.endDate);
    }
  }

  return baseRows.map((row) => {
    const statuses = roleStatusesByProject.get(row.id) ?? [];
    return {
      ...row,
      status: deriveProjectStatus(statuses),
      linesOfBusiness: deriveProjectLinesOfBusiness(
        roleLobsByProject.get(row.id) ?? [],
      ),
      deliveryManagerNames: managersByProject.get(row.id) ?? [],
      roleCount: statuses.length,
      startDate: startDateByProject.get(row.id) ?? null,
      endDate: endDateByProject.get(row.id) ?? null,
    };
  });
}

/**
 * Every project in the given status buckets (no pagination), ordered by name.
 * Used for the Tentative, Paused and Active sections, which show in full.
 */
export async function getProjectsInBuckets(
  buckets: ProjectStatusBucket[],
  filters: ProjectsListFilters = {},
): Promise<ProjectListItem[]> {
  const baseRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      companyId: projects.companyId,
      companyName: companies.name,
    })
    .from(projects)
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .where(projectsWhere(buckets, filters))
    .orderBy(asc(projects.name));

  return assembleRows(baseRows);
}

/**
 * One page of projects in the given status buckets, with the optional
 * name/company + line-of-business + delivery-manager filters. Ordered by `order`
 * (`name` by default; `endDate` for the Past and search/filter views —
 * latest-ending first). Server-side paginated (offset/limit + a count) — used for
 * the Past and Cancelled sections and the flat filtered view, whose result sets
 * grow unbounded. The
 * filter `where` is applied to both the count and the row query so the page count
 * reflects the filtered set. `page` is clamped into range.
 */
export async function getProjectsPage(
  page: number,
  buckets: ProjectStatusBucket[],
  filters: ProjectsListFilters = {},
  order: ProjectsListOrder = "name",
  pageSize = CRM_PAGE_SIZE,
): Promise<Page<ProjectListItem>> {
  const where = projectsWhere(buckets, filters);

  const [{ total }] = await db
    .select({ total: count() })
    .from(projects)
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .where(where);
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
    .where(where)
    .orderBy(...orderClauses(order))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  const rows = await assembleRows(baseRows);
  return { rows, total, page: safePage, pageSize, pageCount };
}
