import "server-only";

import { asc, eq, lte, notInArray, or, sql } from "drizzle-orm";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import type {
  OpportunitySource,
  OpportunityStatus,
} from "@/lib/crm/opportunity";
import {
  BOARD_COLUMN_CAP,
  CAPPED_BOARD_STATUSES,
} from "@/lib/crm/opportunity-pipeline";
import { db } from "@/lib/db/db";
import { companies, opportunities } from "@/lib/db/schema";
import { type OpenTaskSummary, openTasksByParent } from "./getTasks";
import { resolveOwnerNames } from "./opportunityOwnerNames";

export type OpportunityBoardCard = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  source: OpportunitySource;
  status: OpportunityStatus;
  lineOfBusiness: LineOfBusiness;
  ownerNames: string[];
  // Whether a project is linked — drives the delivery-stage requirement in the
  // board (block a move into Allocating+ with no project).
  hasProject: boolean;
  position: number;
  // Epoch millis — the client sorts by (position, createdAt) to match the
  // server's tie-break so a tied position never flips order between renders.
  createdAt: number;
  /** The opportunity's open (not-done) tasks, oldest first — empty when none. */
  openTasks: OpenTaskSummary[];
};

export type OpportunitiesBoardData = {
  cards: OpportunityBoardCard[];
  /**
   * Full count per capped status (see `CAPPED_BOARD_STATUSES`). A column is
   * truncated — and shows a "Show more" link — when its total exceeds the cards
   * returned for it. Absent for uncapped statuses (they're always complete).
   */
  cappedTotals: Partial<Record<OpportunityStatus, number>>;
};

/**
 * The kanban cards. Uncapped columns return in full (ordered by `position`,
 * `createdAt` breaking ties, so columns render in their persisted manual order);
 * the high-volume columns (`CAPPED_BOARD_STATUSES`) return only their
 * `BOARD_COLUMN_CAP` most-recently-updated cards, with the full per-status count
 * in `cappedTotals` so the board knows when to offer "Show more". Non-paginated
 * for the uncapped pipeline (a consultancy's live pipeline is small); a company
 * join plus a single grouped owner-name query (no N+1).
 */
export async function getOpportunitiesBoard(): Promise<OpportunitiesBoardData> {
  // Rank + count within each status column: `rn` (1 = most recently updated)
  // caps the high-volume columns; `statusCount` is the column's full size. Both
  // are window functions, so they must sit in a subquery to be filtered on.
  const ranked = db
    .select({
      id: opportunities.id,
      name: opportunities.name,
      companyId: opportunities.companyId,
      // Aliased: `companies.name` would otherwise emit an output column named
      // `name` that collides with `opportunities.name` when this select is used
      // as a subquery below (duplicate/ambiguous column names).
      companyName: sql<string>`${companies.name}`.as("company_name"),
      source: opportunities.source,
      status: opportunities.status,
      lineOfBusiness: opportunities.lineOfBusiness,
      position: opportunities.position,
      createdAt: opportunities.createdAt,
      // The delivery link lives on the opportunity now, so `hasProject` is a
      // column read — no separate query.
      projectId: opportunities.projectId,
      rn: sql<number>`row_number() over (partition by ${opportunities.status} order by ${opportunities.updatedAt} desc, ${opportunities.id})`.as(
        "rn",
      ),
      statusCount:
        sql<number>`count(*) over (partition by ${opportunities.status})`.as(
          "status_count",
        ),
    })
    .from(opportunities)
    .innerJoin(companies, eq(opportunities.companyId, companies.id))
    .as("ranked");

  const baseRows = await db
    .select()
    .from(ranked)
    // Keep every uncapped-status row; keep only the top `BOARD_COLUMN_CAP` of
    // each capped status (by the `updatedAt desc` rank above).
    .where(
      or(
        notInArray(ranked.status, [...CAPPED_BOARD_STATUSES]),
        lte(ranked.rn, BOARD_COLUMN_CAP),
      ),
    )
    .orderBy(asc(ranked.position), asc(ranked.createdAt));

  const opportunityIds = baseRows.map((r) => r.id);
  const [ownersByOpportunity, openTasks] = await Promise.all([
    resolveOwnerNames(opportunityIds),
    openTasksByParent("opportunity", opportunityIds),
  ]);

  const cappedStatuses = new Set<OpportunityStatus>(CAPPED_BOARD_STATUSES);
  const cappedTotals: Partial<Record<OpportunityStatus, number>> = {};
  for (const row of baseRows) {
    if (cappedStatuses.has(row.status)) {
      cappedTotals[row.status] = row.statusCount;
    }
  }

  const cards = baseRows.map(({ projectId, rn, statusCount, ...r }) => ({
    ...r,
    createdAt: r.createdAt.getTime(),
    openTasks: openTasks.get(r.id) ?? [],
    ownerNames: ownersByOpportunity.get(r.id) ?? [],
    hasProject: projectId != null,
  }));

  return { cards, cappedTotals };
}
