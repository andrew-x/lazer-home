# Remaining-capacity meter in the allocations planner cells

## Context

The `/allocations` planner answers "what is this person on?" but not "how much room do they have?". Each cell stacks one block per project role, and each block shows that role's **nominal rate** capped at 100% (`bucketPercent`). Nothing ever sums a person's load across roles, and the amber "Away" strip sits *beside* the allocation blocks rather than reducing what's available — so a cell can currently read `100%` booked and `100%` away at the same time and nobody notices.

Both `docs/domains/allocations.md` and ADR 0040 call this out as the deliberate gap: *"This is a view, not the missing capacity model … it does not sum a person's load across projects, flag over-allocation, or reconcile against timesheet actuals."* AGENTS.md lists "allocation capacity/over-allocation modelling" first under **Not yet**.

This change delivers the per-cell half of that: a thin fill meter plus a remaining-percent number in every cell, so you can scan a column and see who has headroom and who is oversold. It stays a *view* — no schema change, no new read, no reconciliation against timesheet actuals.

**Decisions taken** (agreed up front):
- **PTO nets out.** Capacity = `100% − away%`. This is the only reading under which "capacity left" is true, and it retires the 100%-booked-and-100%-away contradiction.
- **Tentative counts.** `free = capacity − (confirmed + tentative)`. Conservative — you don't double-sell someone who's pencilled in. The tooltip breaks out the split.
- **Flat 8h/day baseline for everyone.** Reuses the existing `HOURS_PER_FULL_WEEK = 40` constant. `staff_employment.utilizationTarget` stays out of the planner (non-billable roles carry target `0` and would read as permanently over-allocated).

### The month problem this must solve

Displayed percents **cannot simply be summed at month granularity**. A role covering the first half of March shows `100%` (nominal rate, ADR 0040); another covering the second half also shows `100%`. Naively summed that is 200% for a person who is exactly full.

So the meter needs its own **working-day-weighted, uncapped** load figure. At **day** and **week** this is arithmetically identical to what's already displayed (minus the `min(100, …)` cap); only **month** diverges. That narrow divergence is intended and is what the tooltip exists to explain — per-role blocks keep reading as a *rate* (ADR 0040's decision stands), the meter reads as actual *load*.

---

## Design

A meter row is appended as the last child of each cell's existing `flex flex-col gap-1` stack:

```
WEEK COLUMN (w-28)              BENCH                    OVER-ALLOCATED
┌──────────────────┐            ┌──────────────────┐     ┌──────────────────┐
│ Acme        50%  │            │                  │     │ Acme       100%  │
│ Beta        25%  │            │                  │     │ Beta        50%  │
│ ▓▓▓▓▓▓▒▒░░░  25% │            │ ░░░░░░░░░░░ 100% │     │ ███████████ -50% │
└──────────────────┘            └──────────────────┘     └──────────────────┘
  ▓ confirmed  ▒ tentative/away   empty track = all free    whole bar destructive
```

- **Track**: `h-1 bg-muted` (square corners — the design language is 4px radius and flat; no shadow, no rounding on a 4px bar). Segments are plain `div`s with percentage widths — no charting dependency, per `docs/ui.md`.
- **Segments, in order**: confirmed `bg-primary` → tentative `bg-primary/40` → away `bg-amber-300` (the away colour already established in this grid) → remainder is bare track.
- **Over-allocated** (`load + away > 100`): the whole bar renders `bg-destructive`, number renders `-{over}%` in `text-destructive`. Colour is reserved for genuine problems (`docs/ui.md`), and being oversold is one.
- **Number**: `text-[10px] tabular-nums text-muted-foreground`, right-aligned, shrink-0. Fits the tightest column (`day`, `w-24`).
- **Tooltip** (reuse the existing `Tooltip` pattern in `AllocationBlock`, not a `<title>`, so it matches its neighbours): `62% booked · 50% confirmed, 12% tentative` / `40% away` / `25% free` — or `50% over capacity`. At month granularity add a line: `Averaged across the month's working days`.

### Edge cases that must be handled

| Case | Behaviour |
|---|---|
| **Bucket has zero working days** (a weekend column at day granularity) | **Render no meter at all.** Otherwise every Saturday reads "100% free". Gate on `totalWeekdays(colStart, colEnd) === 0`. |
| 100% away | Bar entirely amber, remainder `0%`. Booked on top of that → over. |
| Rounding | Sum **raw floats**, round once at the end, and derive `free`/`over` from the raw sum — so three 33.3% roles read `0% free`, not `1% over`. |
| Person with no allocations and no PTO | Empty track, `100%`. This is the bench signal and is intended. |
| `joinDate` / `terminationDate` | **Not** honoured — consistent with today's grid, which renders active staff across the whole window regardless. Out of scope; note it in the ADR. |

### RBAC

**No new disclosure surface.** The meter is derived entirely from allocation percentages and away percentages that are already rendered in the same cell for every signed-in user. Leave **`type`** — the only `pto.review`-gated field (ADR 0038) — is not read by any of this. No action, gate, or matrix row changes.

---

## Implementation

### 1. `src/lib/allocations/allocations-grid.ts` — the math

Add an uncapped, working-day-weighted load function alongside the existing `bucketPercent`:

```ts
/**
 * A role's real share of a bucket's working capacity — uncapped and prorated at
 * every granularity, unlike `bucketPercent`, which is a display *rate* (ADR 0040).
 * Identical to `bucketPercent` at day and week; only month differs.
 */
export function bucketLoadPercent(
  role: AllocationRoleRow, granularity: Granularity, colStart: Date,
): number {
  const colEnd = bucketEnd(granularity, colStart);
  const total = totalWeekdays(colStart, colEnd);
  if (total === 0) return 0;
  const active = activeWeekdays(colStart, colEnd, role.startDate, role.endDate);
  if (active === 0) return 0;
  return ((role.hoursPerDay * active) / (HOURS_PER_DAY * total)) * 100;
}
```

Reuses the existing module-private helpers `bucketEnd`, `totalWeekdays`, `activeWeekdays`, `HOURS_PER_DAY`. Returns a raw float; callers round.

Add the cell type and extend `BucketCell`:

```ts
export type CapacityCell = {
  confirmedPercent: number;   // rounded, for the tooltip + segment width
  tentativePercent: number;
  awayPercent: number;
  freePercent: number;        // rounded from the raw remainder; 0 when over
  overPercent: number;        // rounded; 0 when within capacity
};

export type BucketCell = {
  allocations: AllocationCell[];
  timeOff: TimeOffCell | null;
  capacity: CapacityCell | null;   // null when the bucket has no working days
};
```

In `buildAllocationRows` (~L411–447), where `workingDays` / `awayDays` are already computed for the time-off strip, additionally accumulate raw confirmed and tentative load over the person's overlapping roles and populate `capacity`. Reuse the **raw** `awayDays / workingDays` fraction, not the already-rounded `timeOff.percent`.

**Leave `bucketPercent` and `weekPercent` untouched.** `weekPercent` is shared with `src/lib/projects/project-planner-grid.ts` (ADR 0040 makes keeping both call sites in step a hard rule) — adding a new function rather than editing the old one means the opportunity planner needs no change.

### 2. `src/components/allocations/allocations-grid.tsx` — the meter

- New internal `CapacityMeter({ capacity, granularity })` component, sitting beside the existing `AllocationBlock` / `TimeOffBlock`.
- Render it as the final child of the cell stack (~L174–196), guarded on `cell.capacity !== null`.
- Add two entries to the exported `AllocationsLegend` (~L324–348): a partially-filled swatch labelled "Remaining capacity" and a destructive swatch labelled "Over-allocated".

### 3. `src/lib/allocations/allocations-grid.test.ts` — tests

Extend the existing `bun:test` suite:
- `bucketLoadPercent` equals `bucketPercent` at day and week for an uncapped role; **diverges at month** for a role covering half the month (`100` vs `~50`).
- Two back-to-back half-month roles sum to `100%` load / `0%` free at month granularity — the case that motivated the whole function.
- A 12h/day role reports `150%` load (uncapped) where `bucketPercent` reports `100`.
- PTO nets out: 40% away + 40% booked → `20%` free; 100% away + any booking → over.
- Weekend column at day granularity → `capacity === null`.
- Rounding: three 33.33% roles → `0%` free, not `1%` over.

### 4. Docs

Dispatch the **`librarian`** subagent afterwards to reconcile `/docs`: a new ADR for the capacity-indicator semantics (PTO nets out, tentative counts, flat baseline, the month-proration divergence and why `bucketPercent` was left alone), plus updates to `docs/domains/allocations.md` (the "this is a view, not the capacity model" blockquote and the open questions now shift — *cross-project summing exists; timesheet reconciliation still doesn't*), `docs/ui.md` (first meter in the app), and the AGENTS.md status line.

---

## Files

| File | Change |
|---|---|
| `src/lib/allocations/allocations-grid.ts` | `bucketLoadPercent`, `CapacityCell`, `BucketCell.capacity`, accumulation in `buildAllocationRows` |
| `src/lib/allocations/allocations-grid.test.ts` | New cases above |
| `src/components/allocations/allocations-grid.tsx` | `CapacityMeter`, cell render, legend |

**Unchanged, deliberately:** `getAllocationsGrid.ts` (the read already carries everything), `project-planner-grid.ts`, any action or permission, the DB schema.

---

## Verification

1. `bun test src/lib/allocations/allocations-grid.test.ts` — the math, including the month case.
2. `bun run check` — Biome + `tsc --noEmit` + full test suite.
3. `bun run build`.
4. `bun run dev`, open `/allocations`, and confirm by eye:
   - **Week** (default): a person on one 4h/day role reads `50%` free; the meter's filled portion is half.
   - **Day**: weekend columns show **no meter**; a weekday with a full-time role shows a full bar and `0%`.
   - **Month**: two back-to-back half-month roles on one person read `0%` free — *not* `-100%`. This is the regression the whole design turns on.
   - Someone with approved PTO in the window shows an amber meter segment matching the "Away" strip's percentage, and their free number drops accordingly.
   - Someone deliberately over-booked (two overlapping full-time roles) shows a destructive bar and a negative number.
   - Tooltip breaks out confirmed / tentative / away / free, and adds the averaging note at month granularity.
