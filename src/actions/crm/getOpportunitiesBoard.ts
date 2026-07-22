import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import {
  latestNextStepSubquery,
  toEpochMillis,
} from "@/actions/shared/latestNextStep";
import type {
  OpportunitySource,
  OpportunityStatus,
} from "@/lib/crm/opportunity";
import { db } from "@/lib/db/db";
import {
  companies,
  opportunities,
  opportunityEntries,
  opportunityOwners,
  staff,
} from "@/lib/db/schema";

export type OpportunityBoardCard = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  source: OpportunitySource;
  status: OpportunityStatus;
  ownerNames: string[];
  // Whether a project is linked — drives the delivery-stage requirement in the
  // board (block a move into Allocating+ with no project).
  hasProject: boolean;
  position: number;
  // Epoch millis — the client sorts by (position, createdAt) to match the
  // server's tie-break so a tied position never flips order between renders.
  createdAt: number;
  /** Body of the most recent next-step entry, or null if none. */
  nextStep: string | null;
  /** When that next step was logged (epoch millis), or null. */
  nextStepAt: number | null;
};

/**
 * Every opportunity as a kanban card, ordered by `position` (createdAt breaks
 * ties) so columns render in their persisted manual order. Non-paginated (a
 * consultancy's pipeline is small): a company join plus a single grouped
 * owner-name query (no N+1).
 */
export async function getOpportunitiesBoard(): Promise<OpportunityBoardCard[]> {
  // Latest next-step per opportunity: one row per opportunity, newest
  // `next_step` first.
  const latestNextStep = latestNextStepSubquery(
    opportunityEntries,
    opportunityEntries.opportunityId,
  );

  const baseRows = await db
    .select({
      id: opportunities.id,
      name: opportunities.name,
      companyId: opportunities.companyId,
      companyName: companies.name,
      source: opportunities.source,
      status: opportunities.status,
      position: opportunities.position,
      createdAt: opportunities.createdAt,
      nextStep: latestNextStep.body,
      nextStepAt: latestNextStep.createdAt,
      // The delivery link lives on the opportunity now, so `hasProject` is a
      // column read — no separate query.
      projectId: opportunities.projectId,
    })
    .from(opportunities)
    .innerJoin(companies, eq(opportunities.companyId, companies.id))
    .leftJoin(latestNextStep, eq(latestNextStep.parentId, opportunities.id))
    .orderBy(asc(opportunities.position), asc(opportunities.createdAt));

  // Resolve owner names for all cards in a single grouped query (no N+1).
  const ownersByOpportunity = new Map<string, string[]>();
  if (baseRows.length > 0) {
    const ids = baseRows.map((r) => r.id);

    const ownerRows = await db
      .select({
        opportunityId: opportunityOwners.opportunityId,
        name: staff.name,
      })
      .from(opportunityOwners)
      .innerJoin(staff, eq(opportunityOwners.staffId, staff.id))
      .where(inArray(opportunityOwners.opportunityId, ids))
      .orderBy(asc(staff.name));

    for (const { opportunityId, name } of ownerRows) {
      const list = ownersByOpportunity.get(opportunityId) ?? [];
      list.push(name);
      ownersByOpportunity.set(opportunityId, list);
    }
  }

  return baseRows.map(({ projectId, ...r }) => ({
    ...r,
    createdAt: r.createdAt.getTime(),
    nextStepAt: toEpochMillis(r.nextStepAt),
    ownerNames: ownersByOpportunity.get(r.id) ?? [],
    hasProject: projectId != null,
  }));
}
