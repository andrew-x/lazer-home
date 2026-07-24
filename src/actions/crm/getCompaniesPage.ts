import "server-only";

import {
  and,
  asc,
  count,
  eq,
  exists,
  ilike,
  inArray,
  notExists,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm";
import { CRM_PAGE_SIZE, clampPage, type Page } from "@/lib/core/pagination";
import type { CompanyStatusTag } from "@/lib/crm/company-status";
import { CLOSED_OPPORTUNITY_STATUSES } from "@/lib/crm/opportunity";
import { db } from "@/lib/db/db";
import {
  companies,
  opportunities,
  projectRoles,
  projects,
} from "@/lib/db/schema";

export type CompanyRow = {
  id: string;
  name: string;
  // Derived status flags (see src/lib/company-status.ts). `isPartner` is the
  // stored manual flag; `isClient`/`isProspect` are computed from the pipeline.
  isPartner: boolean;
  isClient: boolean;
  isProspect: boolean;
};

/** Optional filters for the companies list — name search and a single status tag. */
export type CompanyListFilters = {
  query?: string;
  status?: CompanyStatusTag;
};

// A company is a **client** iff it has at least one confirmed project. There's
// no direct company→project link — projects hang off opportunities — so we
// correlate through `opportunities.projectId`. A project no longer stores a
// status: it's *derived* from its roles ("least-committed wins", see
// `deriveProjectStatus` in `src/lib/project-derived.ts`), so "confirmed" means
// the project has at least one confirmed role and no tentative/paused role.
//
// LOCKSTEP: this SQL re-expresses `deriveProjectStatus(...) === "confirmed"` in
// the database. The two definitions of "confirmed" MUST stay in sync — if you
// change the precedence in `project-derived.ts`, update this expression too.
// `src/lib/project-derived.test.ts` asserts the two rules agree across fixtures.
//
// The raw `exists(...)` condition is reused both as a selected boolean (via
// `.mapWith(Boolean)` below) and as a `where` filter for the status dropdown.
const hasConfirmedProject = exists(
  db
    .select({ n: sql`1` })
    .from(opportunities)
    .innerJoin(projects, eq(projects.id, opportunities.projectId))
    .where(
      and(
        eq(opportunities.companyId, companies.id),
        exists(
          db
            .select({ n: sql`1` })
            .from(projectRoles)
            .where(
              and(
                eq(projectRoles.projectId, projects.id),
                eq(projectRoles.status, "confirmed"),
              ),
            ),
        ),
        notExists(
          db
            .select({ n: sql`1` })
            .from(projectRoles)
            .where(
              and(
                eq(projectRoles.projectId, projects.id),
                inArray(projectRoles.status, ["tentative", "paused"]),
              ),
            ),
        ),
      ),
    ),
);

// A company is a **prospect** iff it has at least one open (non-closed)
// opportunity. Closed deals (won/lost) don't count — a won company shows as a
// client instead, and a lost-only company carries no tag.
const hasOpenOpportunity = exists(
  db
    .select({ n: sql`1` })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.companyId, companies.id),
        notInArray(opportunities.status, [...CLOSED_OPPORTUNITY_STATUSES]),
      ),
    ),
);

const isClientExpr = hasConfirmedProject.mapWith(Boolean);
const isProspectExpr = hasOpenOpportunity.mapWith(Boolean);

/** The `where` condition that selects a single derived status tag. */
const STATUS_CONDITION: Record<CompanyStatusTag, SQL> = {
  partner: eq(companies.isPartner, true),
  client: hasConfirmedProject,
  prospect: hasOpenOpportunity,
};

/** Build the combined `where` for the given filters (undefined when none apply). */
function companiesWhere(filters: CompanyListFilters): SQL | undefined {
  const conditions: SQL[] = [];
  const query = filters.query?.trim();
  if (query) conditions.push(ilike(companies.name, `%${query}%`));
  if (filters.status) conditions.push(STATUS_CONDITION[filters.status]);
  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * One page of companies, ordered by name, optionally filtered by name search
 * and/or a single status tag. Server-side paginated (offset/limit + a count) —
 * the dataset is expected to grow large. `page` is clamped into range so an
 * out-of-bounds query param can't return an empty page past the end. The filter
 * `where` is applied to BOTH the count and the row query so the total (and thus
 * the page count) reflects the filtered set.
 *
 * Each row carries its derived status flags (client/prospect), computed inline
 * as correlated `EXISTS` subqueries so the page stays a single query.
 */
export async function getCompaniesPage(
  page = 1,
  filters: CompanyListFilters = {},
  pageSize = CRM_PAGE_SIZE,
): Promise<Page<CompanyRow>> {
  const where = companiesWhere(filters);

  const [{ total }] = await db
    .select({ total: count() })
    .from(companies)
    .where(where);
  const { pageCount, safePage } = clampPage(total, page, pageSize);

  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      isPartner: companies.isPartner,
      isClient: isClientExpr,
      isProspect: isProspectExpr,
    })
    .from(companies)
    .where(where)
    .orderBy(asc(companies.name))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  return { rows, total, page: safePage, pageSize, pageCount };
}
