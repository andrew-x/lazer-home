/**
 * The opportunity pipeline: how the flat `OPPORTUNITY_STATUSES` leaf enum groups
 * into the kanban columns. Declared here as a pure, client-importable module (no
 * `db`/drizzle, no UI) so the board, the move action, and any server code share
 * one source of truth — mirrors `src/lib/line-of-business.ts`.
 *
 * `OPPORTUNITY_GROUPS` is ordered by pipeline position and, flattened, must equal
 * `OPPORTUNITY_STATUSES` in the same order (asserted at module load below). Most
 * groups hold a single status; Scoping/Allocating/Closing hold several
 * substatuses that a board column can collapse into one or expand into subcolumns.
 */
import {
  OPPORTUNITY_STATUSES,
  type OpportunityStatus,
} from "@/actions/crm/createOpportunity.schema";

export type OpportunityGroupId =
  | "maturing"
  | "lead"
  | "qualifying"
  | "scoping"
  | "allocating"
  | "negotiating"
  | "closing"
  | "won"
  | "lost";

export type OpportunityGroup = {
  id: OpportunityGroupId;
  label: string;
  statuses: readonly OpportunityStatus[];
};

/** Groups in pipeline order. Flattened `statuses` === `OPPORTUNITY_STATUSES`. */
export const OPPORTUNITY_GROUPS: readonly OpportunityGroup[] = [
  { id: "maturing", label: "Maturing", statuses: ["maturing"] },
  { id: "lead", label: "Lead", statuses: ["lead"] },
  { id: "qualifying", label: "Qualifying", statuses: ["qualifying"] },
  {
    id: "scoping",
    label: "Scoping",
    statuses: ["scoping_awaiting_info", "scoping", "scoping_reviewing"],
  },
  {
    id: "allocating",
    label: "Allocating",
    statuses: ["allocating_awaiting_profiles", "allocating_introing_profiles"],
  },
  { id: "negotiating", label: "Negotiating", statuses: ["negotiating"] },
  {
    id: "closing",
    label: "Closing",
    statuses: [
      "closing_awaiting_contracts",
      "closing_redlining",
      "closing_awaiting_signatures",
    ],
  },
  { id: "won", label: "Won", statuses: ["closed_won"] },
  { id: "lost", label: "Lost", statuses: ["closed_lost"] },
];

// --- Derived lookups (computed once at module load) ------------------------

const groupIndexById = {} as Record<OpportunityGroupId, number>;
const groupByStatus = {} as Record<OpportunityStatus, OpportunityGroup>;

OPPORTUNITY_GROUPS.forEach((group, index) => {
  groupIndexById[group.id] = index;
  for (const status of group.statuses) groupByStatus[status] = group;
});

export const GROUP_INDEX_BY_ID: Readonly<Record<OpportunityGroupId, number>> =
  groupIndexById;

/** The group a leaf status belongs to. */
export function groupOfStatus(status: OpportunityStatus): OpportunityGroup {
  return groupByStatus[status];
}

/** A status's group's pipeline index — the notion of "earlier/later" in the pipeline. */
export function groupIndexOfStatus(status: OpportunityStatus): number {
  return GROUP_INDEX_BY_ID[groupByStatus[status].id];
}

// Lockstep guard: the groups must cover every status exactly once, in order.
// Same "deliberate friction" idea as the permissions matrix test — the two
// structures can't drift silently.
{
  const flat = OPPORTUNITY_GROUPS.flatMap((g) => g.statuses);
  const matches =
    flat.length === OPPORTUNITY_STATUSES.length &&
    flat.every((status, i) => status === OPPORTUNITY_STATUSES[i]);
  if (!matches) {
    throw new Error(
      "opportunity-pipeline: OPPORTUNITY_GROUPS (flattened) must equal OPPORTUNITY_STATUSES in the same order.",
    );
  }
}

// --- Drag-and-drop helpers -------------------------------------------------

/** Which status a card takes when dropped on a board column. */
export type DropTarget =
  | { kind: "status"; status: OpportunityStatus }
  | { kind: "group"; groupId: OpportunityGroupId };

/**
 * Resolve the status a dragged card should take when dropped on `target`.
 *
 * - A concrete-status column (a single-status group, or an expanded subcolumn)
 *   always yields its own status.
 * - A collapsed multi-status group yields, per the product rule, the group's
 *   FIRST substatus when the card comes from an EARLIER part of the pipeline and
 *   the LAST when it comes from a LATER part — "earlier/later" measured by group
 *   pipeline index. Reordering within the same collapsed group keeps the card's
 *   own substatus.
 */
export function resolveTargetStatus(
  target: DropTarget,
  originStatus: OpportunityStatus,
): OpportunityStatus {
  if (target.kind === "status") return target.status;

  const group = OPPORTUNITY_GROUPS[GROUP_INDEX_BY_ID[target.groupId]];
  if (group.statuses.length === 1) return group.statuses[0];

  const originGroupIdx = groupIndexOfStatus(originStatus);
  const destGroupIdx = GROUP_INDEX_BY_ID[group.id];

  if (originGroupIdx === destGroupIdx) return originStatus;
  if (originGroupIdx < destGroupIdx) return group.statuses[0];
  return group.statuses[group.statuses.length - 1];
}

/**
 * The fractional `position` for a card inserted between two neighbors in a
 * column (both already sorted by position, dragged card excluded). `null`
 * neighbor means the card lands at that end (or the column is empty).
 */
export function computePosition(
  before: number | null,
  after: number | null,
): number {
  if (before === null && after === null) return 0;
  if (before === null) return (after as number) - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}
