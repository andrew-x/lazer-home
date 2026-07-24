import "server-only";

import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  type SQL,
} from "drizzle-orm";
import { CRM_PAGE_SIZE, clampPage, type Page } from "@/lib/core/pagination";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import type { OpportunityStatus } from "@/lib/crm/opportunity";
import {
  type OpportunityGroupId,
  opportunityGroupById,
} from "@/lib/crm/opportunity-pipeline";
import { db } from "@/lib/db/db";
import { companies, opportunities } from "@/lib/db/schema";
import { resolveOwnerNames } from "./opportunityOwnerNames";

export type OpportunityRow = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  status: OpportunityStatus;
  lineOfBusiness: LineOfBusiness;
  ownerNames: string[];
  /** Last-updated timestamp as epoch millis (the list's sort key). */
  updatedAt: number;
};

export type OpportunitiesPageFilters = {
  /** Stage filter, as a kanban group id (expands to the group's statuses). */
  group?: OpportunityGroupId;
  lineOfBusiness?: LineOfBusiness;
  /** Case-insensitive substring match on opportunity or company name. */
  query?: string;
};

/**
 * One page of opportunities as a flat list, most-recently-updated first, with
 * optional stage / line-of-business / name filters. The list-view counterpart to
 * the kanban `getOpportunitiesBoard` — server-side paginated (offset/limit + a
 * count) because the closed columns grow unbounded. `page` is clamped into range.
 *
 * Read parity with `getCompaniesPage`: no capability gate beyond the
 * authenticated `(app)` layout — CRM reads aren't gated per-capability here.
 */
export async function getOpportunitiesPage(
  page = 1,
  filters: OpportunitiesPageFilters = {},
  pageSize = CRM_PAGE_SIZE,
): Promise<Page<OpportunityRow>> {
  const conditions: SQL[] = [];

  if (filters.group) {
    conditions.push(
      inArray(opportunities.status, [
        ...opportunityGroupById(filters.group).statuses,
      ]),
    );
  }
  if (filters.lineOfBusiness) {
    conditions.push(eq(opportunities.lineOfBusiness, filters.lineOfBusiness));
  }
  const query = filters.query?.trim();
  if (query) {
    const term = `%${query}%`;
    const nameMatch = or(
      ilike(opportunities.name, term),
      ilike(companies.name, term),
    );
    if (nameMatch) conditions.push(nameMatch);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(opportunities)
    .innerJoin(companies, eq(opportunities.companyId, companies.id))
    .where(where);
  const { pageCount, safePage } = clampPage(total, page, pageSize);

  const baseRows = await db
    .select({
      id: opportunities.id,
      name: opportunities.name,
      companyId: opportunities.companyId,
      companyName: companies.name,
      status: opportunities.status,
      lineOfBusiness: opportunities.lineOfBusiness,
      updatedAt: opportunities.updatedAt,
    })
    .from(opportunities)
    .innerJoin(companies, eq(opportunities.companyId, companies.id))
    .where(where)
    // Most-recently-updated first; `id` breaks ties so paging is stable.
    .orderBy(desc(opportunities.updatedAt), desc(opportunities.id))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  const ownersByOpportunity = await resolveOwnerNames(
    baseRows.map((r) => r.id),
  );

  const rows: OpportunityRow[] = baseRows.map((r) => ({
    ...r,
    updatedAt: r.updatedAt.getTime(),
    ownerNames: ownersByOpportunity.get(r.id) ?? [],
  }));

  return { rows, total, page: safePage, pageSize, pageCount };
}
