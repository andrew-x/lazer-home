import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/db";
import {
  companies,
  opportunities,
  opportunityOwners,
  staff,
} from "@/lib/db/schema";
import type {
  OpportunitySource,
  OpportunityStatus,
} from "./createOpportunity.schema";

export type OpportunityBoardCard = {
  id: string;
  name: string;
  companyName: string;
  source: OpportunitySource;
  status: OpportunityStatus;
  ownerNames: string[];
  position: number;
  // Epoch millis — the client sorts by (position, createdAt) to match the
  // server's tie-break so a tied position never flips order between renders.
  createdAt: number;
};

/**
 * Every opportunity as a kanban card, ordered by `position` (createdAt breaks
 * ties) so columns render in their persisted manual order. Non-paginated (a
 * consultancy's pipeline is small): a company join plus a single grouped
 * owner-name query (no N+1).
 */
export async function getOpportunitiesBoard(): Promise<OpportunityBoardCard[]> {
  const baseRows = await db
    .select({
      id: opportunities.id,
      name: opportunities.name,
      companyName: companies.name,
      source: opportunities.source,
      status: opportunities.status,
      position: opportunities.position,
      createdAt: opportunities.createdAt,
    })
    .from(opportunities)
    .innerJoin(companies, eq(opportunities.companyId, companies.id))
    .orderBy(asc(opportunities.position), asc(opportunities.createdAt));

  // Resolve owner names for all cards in one grouped query.
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

  return baseRows.map((r) => ({
    ...r,
    createdAt: r.createdAt.getTime(),
    ownerNames: ownersByOpportunity.get(r.id) ?? [],
  }));
}
