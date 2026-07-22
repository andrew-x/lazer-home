# 0021 — Opportunity pipeline: status groups in code + single global fractional ordering

**Status:** accepted · 2026-07-09

## Context

The opportunities pipeline moved from a flat, static list to a **kanban board**
(`/opportunities`), which raised two design questions:

1. **Stage granularity.** The pipeline grew from 7 flat statuses to **14 leaf
   statuses**, but several belong together as one board column that can drill down
   (Scoping → awaiting info / scoping / reviewing; Allocating → awaiting profiles /
   introing profiles; Closing → awaiting contracts / redlining / awaiting
   signatures). We needed *grouping* without turning the enum into a two-level
   database structure.
2. **Manual card ordering.** Cards need a persisted, user-controlled order within a
   column, and a drag must not force renumbering the whole column.

## Decision

**Status groups are derived in code from a flat leaf enum.** The database column
stays a **single flat `pgEnum` (`opportunity_status`)** of 14 leaf values. The
group structure lives only in the pure module `src/lib/crm/opportunity-pipeline.ts`
(`OPPORTUNITY_GROUPS`), which maps ordered groups → their substatuses. The leaf
tuple (`OPPORTUNITY_STATUSES`) remains the single source of truth in
`src/lib/crm/opportunity.ts`, in **strict pipeline order** (array
index === pipeline position); the `pgEnum` derives from it (ADR 0016). A
**module-load assertion** enforces that
`OPPORTUNITY_GROUPS` flattened equals `OPPORTUNITY_STATUSES` in the same order, so
the two structures can't drift silently — the same "deliberate friction" idea as
the permissions matrix test. This mirrors the `src/lib/crm/line-of-business.ts` pattern.

**Ordering is a single global fractional index.** `opportunities.position`
(`doublePrecision NOT NULL DEFAULT 0`) is *one* global ordering, not per-column.
Cards in a column sort by `(position, createdAt)` — `createdAt` breaks ties so a
tied position never flips order between renders. A **drag writes the midpoint**
between its two new neighbours (`computePosition`), so a move is a **single-row
update** with no column-wide renumbering; the move action
(`updateOpportunityPosition`) takes an absolute `{ id, status, position }` computed
client-side. A **new opportunity gets `max(position) + 1`** (global), landing at the
end of whichever column it's in. Index `opportunities_status_position_idx` on
`(status, position)` backs the ordered read.

## Consequences

- Adding/renaming a stage stays a one-line change to the leaf tuple; regrouping is a
  pure edit to `OPPORTUNITY_GROUPS`. No schema migration for regrouping, since the DB
  only knows leaves.
- The board can **collapse** a multi-substatus group into one column (cards show a
  substatus badge) or **expand** it into subcolumns — a pure UI concern (local state,
  collapsed by default), because grouping isn't persisted.
- Dropping onto a *collapsed* group needs a rule to pick a leaf: the group's **first**
  substatus if the card came from **earlier** in the pipeline, the **last** if from
  **later** (`resolveTargetStatus`, measured by group pipeline index). Reordering
  within the same collapsed group keeps the card's own substatus.
- A move touches one row, so drags stay cheap even as the pipeline grows.
- **Accepted limitation: no fractional-index rebalancing.** Repeatedly dropping
  between the *same* adjacent pair halves the gap each time; float precision could
  exhaust after ~50 such midpoints. Implausible at a consultancy's pipeline scale, so
  we deliberately skipped a rebalancing pass. If it ever bites, add a renumber-column
  routine.

## Alternatives considered

- **Two-level status in the DB** (a `group` column + a `substatus` column, or a
  composite enum) — rejected: the extra column must be kept consistent with the leaf,
  and regrouping becomes a migration. Deriving groups in code is free and keeps the DB
  minimal.
- **Integer `position` with per-column renumbering** — rejected: every reorder rewrites
  many rows. Fractional indexing makes a move a single write.
- **Per-column `position`** — rejected: a global index is simpler (one `max()` for
  appends) and the `(status, position)` sort already scopes ordering to a column;
  cross-column moves just overwrite `status` + `position` together.
