import "server-only";

import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/db";
import {
  companies,
  opportunities,
  opportunityOwners,
  staff,
} from "@/lib/db/schema";
import { CRM_PAGE_SIZE, clampPage, type Page } from "@/lib/pagination";
import type {
  OpportunitySource,
  OpportunityStatus,
} from "./createOpportunity.schema";

export type OpportunityRow = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  source: OpportunitySource;
  status: OpportunityStatus;
  nextSteps: string | null;
  ownerNames: string[];
};

/**
 * One page of opportunities, ordered by creation (newest first), with the
 * company name resolved via a join and owner names resolved via a single
 * grouped follow-up query (no N+1). Server-side paginated like companies;
 * `page` is clamped into range.
 */
export async function getOpportunitiesPage(
  page = 1,
  pageSize = CRM_PAGE_SIZE,
): Promise<Page<OpportunityRow>> {
  const [{ total }] = await db.select({ total: count() }).from(opportunities);
  const { pageCount, safePage } = clampPage(total, page, pageSize);

  const baseRows = await db
    .select({
      id: opportunities.id,
      name: opportunities.name,
      companyId: opportunities.companyId,
      companyName: companies.name,
      source: opportunities.source,
      status: opportunities.status,
      nextSteps: opportunities.nextSteps,
    })
    .from(opportunities)
    .innerJoin(companies, eq(opportunities.companyId, companies.id))
    .orderBy(desc(opportunities.createdAt))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  // Resolve owner names for just this page's opportunities in one query.
  const ownersByOpportunity = new Map<string, string[]>();
  if (baseRows.length > 0) {
    const ownerRows = await db
      .select({
        opportunityId: opportunityOwners.opportunityId,
        name: staff.name,
      })
      .from(opportunityOwners)
      .innerJoin(staff, eq(opportunityOwners.staffId, staff.id))
      .where(
        inArray(
          opportunityOwners.opportunityId,
          baseRows.map((r) => r.id),
        ),
      )
      .orderBy(asc(staff.name));

    for (const { opportunityId, name } of ownerRows) {
      const list = ownersByOpportunity.get(opportunityId) ?? [];
      list.push(name);
      ownersByOpportunity.set(opportunityId, list);
    }
  }

  const rows: OpportunityRow[] = baseRows.map((r) => ({
    ...r,
    ownerNames: ownersByOpportunity.get(r.id) ?? [],
  }));

  return { rows, total, page: safePage, pageSize, pageCount };
}
