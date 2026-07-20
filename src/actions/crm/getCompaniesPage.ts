import "server-only";

import {
  and,
  asc,
  count,
  eq,
  exists,
  inArray,
  notExists,
  notInArray,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db/db";
import {
  companies,
  opportunities,
  projectRoles,
  projects,
} from "@/lib/db/schema";
import { CLOSED_OPPORTUNITY_STATUSES } from "@/lib/opportunity";
import { CRM_PAGE_SIZE, clampPage, type Page } from "@/lib/pagination";

export type CompanyRow = {
  id: string;
  name: string;
  // Derived status flags (see src/lib/company-status.ts). `isPartner` is the
  // stored manual flag; `isClient`/`isProspect` are computed from the pipeline.
  isPartner: boolean;
  isClient: boolean;
  isProspect: boolean;
};

// A company is a **client** iff it has at least one confirmed project. There's
// no direct company→project link — projects hang off opportunities — so we
// correlate through `opportunities.projectId`. A project no longer stores a
// status: it's *derived* from its roles ("least-committed wins", see
// `deriveProjectStatus` in `src/lib/project-derived.ts`), so "confirmed" means
// the project has at least one confirmed role and no tentative/paused role.
const isClientExpr = exists(
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
).mapWith(Boolean);

// A company is a **prospect** iff it has at least one open (non-closed)
// opportunity. Closed deals (won/lost) don't count — a won company shows as a
// client instead, and a lost-only company carries no tag.
const isProspectExpr = exists(
  db
    .select({ n: sql`1` })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.companyId, companies.id),
        notInArray(opportunities.status, [...CLOSED_OPPORTUNITY_STATUSES]),
      ),
    ),
).mapWith(Boolean);

/**
 * One page of companies, ordered by name. Server-side paginated (offset/limit +
 * a count) — the dataset is expected to grow large. `page` is clamped into range
 * so an out-of-bounds query param can't return an empty page past the end.
 *
 * Each row carries its derived status flags (client/prospect), computed inline
 * as correlated `EXISTS` subqueries so the page stays a single query.
 */
export async function getCompaniesPage(
  page = 1,
  pageSize = CRM_PAGE_SIZE,
): Promise<Page<CompanyRow>> {
  const [{ total }] = await db.select({ total: count() }).from(companies);
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
    .orderBy(asc(companies.name))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  return { rows, total, page: safePage, pageSize, pageCount };
}
