# Discretionary bonus in the compensation-plan editor

## Context

The plan editor (`/performance/compensation-plans/[planId]`) today proposes exactly **one**
compensation figure per person — `plannedAmount`, an ongoing annual base or hourly rate —
and derives Change / Change % / Gap / Gap % from it. A comp round in practice also awards
**one-off discretionary bonuses**, and there is nowhere to record them: they end up in a
spreadsheet beside the plan, so the round's total cash cost is never visible in one place.

This adds a per-person discretionary bonus to the plan, a derived bonus percentage beside
it, and a plan-level total so the round's bonus spend is a number on the screen.

**It changes nothing about who writes pay.** ADR 0020 stands: Rippling (and payroll) remain
the systems of record. The bonus is a proposal recorded on the plan, exactly like
`plannedAmount`, and commit still writes only ratings.

### Decisions taken

| | |
|---|---|
| **Lump sum** | An absolute cash amount, entered directly. Not a % input, not a rate. |
| **No unit** | The annual/hourly toggle **must not** restate it — a lump sum has no unit. |
| **Excluded from Change and Gap** | Those columns are about ongoing comp; folding a one-off in would corrupt both, and Gap compares against an annual level target. |
| **One currency per row** | Reuses `plannedCurrency` — no second currency column, no second picker. This is what "plan currency" means here. |
| **Bonus % is derived, read-only** | Computed like Change % / Gap %, not an input. |
| **Total in CAD when the display toggle is "Default"** | Labelled via `formatMoney`, so "CA$" is always on screen. Follows the toggle when CAD or USD is forced. |

### Assumption to check — the Bonus % denominator

`Bonus % = bonus ÷ current comp, annualized`, converted through USD.

Rationale: both existing percentage columns divide by **current** comp (`changePercent` =
change ÷ current, `gapPercent` = (target − planned) ÷ current), and a discretionary bonus
rewards the period just worked, so current base is the honest denominator. The alternative
— % of *planned* comp — would be the odd one out in the grid and would move every bonus
percentage whenever someone edits an unrelated raise. Say the word if you want planned
instead; it is a one-line change in `bonusPercent`.

## Changes

### 1. Schema — one nullable column

`src/lib/db/performance-schema.ts`, on `compensationPlanItem`, next to `plannedAmount`:

```ts
// A one-off discretionary bonus proposed alongside the ongoing figure. A LUMP SUM,
// not a rate: never restated by the annual/hourly toggle, and deliberately absent
// from Change and Gap, which are about ongoing compensation. Denominated in
// `plannedCurrency` — one currency governs both of this row's proposed figures.
plannedBonus: numeric({ precision: 12, scale: 2, mode: "number" }),
```

Extend `plannedCurrency`'s existing comment to say it now covers both figures. Nullable, so
no backfill: `bun run db:generate` → `bun run db:migrate`.

### 2. Pure money math — `src/lib/performance/compensation-plan.ts`

Two new pure functions beside `planChange` / `levelTargetGap`, both computing from **native**
amounts cross-rated through USD so neither toggle can move them:

- `bonusPercent({ bonusAmount, bonusCurrency, currentAmount, currentCurrency, unit, usdRates })`
  → `number | null`. Annualizes current with `convertCompUnit(current, unit, "ANNUAL")`.
  Null when either leg is missing or annualized current is 0.
- `planBonusTotals({ rows, currency, usdRates })` → `{ total, people, percentOfCurrent }`.
  A sum-over-sum for `percentOfCurrent` (never a mean of ratios). Takes a minimal row shape
  so both the summary strip and the commit dialog use one implementation.
- `PLAN_SUMMARY_CURRENCY: Currency = "CAD"` — the reporting currency for plan-level totals,
  matching `COMP_TARGET_CURRENCY`'s reasoning. Declared locally rather than imported from
  `compensation-targets.ts` to keep that module's import graph type-only.

Extend `src/lib/performance/compensation-plan.test.ts` (a named ADR 0037 exception for comp
money math): denominator + annualization, FX conversion, null/zero guards, mixed-currency
totals, and — the load-bearing one — that flipping the display unit changes neither the
bonus nor its percentage.

### 3. Save path

- `src/actions/performance/saveCompensationPlanItem.schema.ts` — add to the patch:
  `plannedBonus: z.number().min(0, "A bonus can't be negative.").max(PLANNED_AMOUNT_MAX).nullable().optional()`.
  Reuses the existing `PLANNED_AMOUNT_MAX` (the `numeric(12,2)` ceiling).
- `src/actions/performance/saveCompensationPlanItem.ts` — select `plannedBonus`, write it
  under the same `"plannedBonus" in patch` guard, and **widen the currency invariant**: a
  currency is required when *either* `plannedAmount` or `plannedBonus` is non-null, using
  the same `"x" in patch ? update.x : item.x` resolution already there.
- Gate unchanged (`COMPENSATION_PLAN_ACCESS`), no new matrix row, so `permissions.ts`, its
  test and `docs/domains/permissions.md` are untouched.
- `src/actions/performance/getCompensationPlan.ts` — select `plannedBonus` and add
  `plannedBonus: number | null` to `CompensationPlanEditorItem`.

### 4. Autosave — folded into the existing `planned` field

`src/components/performance/compensation-plans/use-plan-autosave.ts`:

- `PlanRowDraft` gains `plannedBonus: number | null` and `plannedBonusText: string`, seeded
  in `draftFromItem`. Document that the bonus needs **no** unit split (the reason
  `plannedCanonical`/`plannedText`/`plannedUnit` exists) precisely because it is a lump sum.
- `patchFor("planned")` also sends `plannedBonus`, and the field's doc comment becomes: the
  `planned` key covers the row's whole comp proposal — ongoing amount, bonus, and the shared
  currency — because they share one currency and must never be written apart.
- New `setPlannedBonusText(itemId, text)` reusing `parsePlannedAmount`, rounding to 2dp, with
  **no** `convertCompUnit` call. `NUMBER_DELAY_MS` debounce is inherited.

*Rejected alternative:* a separate `bonus` save key. Two keys would both write
`plannedCurrency` and could clobber each other — exactly what the per-field design prevents.

### 5. Grid columns

`plan-columns.ts` — insert **after `gapPercent`**, keeping the Gap pair adjacent the way
Change/Change % is:

```
Name | Rating | Current | Planned | Change | Change % | Gap | Gap % | Discretionary bonus | Bonus % | Status |
```

```ts
// Holds an input, so left-aligned — same exception as Planned.
{ key: "bonusAmount", label: "Discretionary bonus", sort: "bonusAmount" },
{ key: "bonusPercent", label: "Bonus %", sort: "bonusPercent", numeric: true },
```

`PLAN_COLUMN_COUNT` is derived, so the expanded panel's `colSpan` follows automatically.

`plan-view.ts` — add `"bonusAmount" | "bonusPercent"` to `PlanSortKey`, both in `DESC_FIRST`
(the interesting end is the top), both reading off `view.sort`.

`plan-row-view.ts` — add `bonus: { amount: number | null; percent: number | null }` (amount
converted into `view.currency` with `convert`, percent from `bonusPercent`) and sort values
`bonusUsd` (**not** annualized — it is a lump sum) and `bonusPercent`. Comment that
`inRowUnit` is deliberately never applied to the bonus and that it is absent from `change`
and `gap` by design.

### 6. Cells

`plan-row.tsx`, two cells after Gap %:

- **Discretionary bonus** — read-only renders
  `formatMoney(draft.plannedBonus, draft.plannedCurrency, { maximumFractionDigits: 0 })` or
  `<EmptyCell />`. Editable renders a new `BonusField`, exported from
  `planned-comp-field.tsx` (same concern, same currency): a bare shadcn
  `<Input type="number" inputMode="decimal" min={0} step={500} className="w-28 tabular-nums" />`
  with `aria-label={`Discretionary bonus for ${item.name}`}`, `onChange → onPlannedBonusText`,
  `onBlur → onFieldCommit("planned")`, and the muted `≈` FX echo already used for the planned
  input when `draft.plannedCurrency !== view.currency`. **No currency select and no unit
  toggle** — the row's currency governs.
- **Bonus %** — `PLAN_NUMERIC_CELL`, `formatChangePercent(view.bonus.percent)`, no tone (a
  bonus is never bad news — same reasoning as the Gap columns' existing no-tone note).

### 7. Plan-level summary

`plan-editor.tsx` — a `useMemo` over `views` (**all** items, matching `incompleteCount`'s
"committing acts on the whole plan"), plus a second over `visible` when
`hasActivePlanFilters(filters)` (helper already exists in `plan-view.ts`). Summary currency
is `displayMode === "DEFAULT" ? PLAN_SUMMARY_CURRENCY : displayMode`, formatted with
`aggregateMoneyFormatters(...).money` from `src/lib/format/currency.ts`.

Rendered as a strip directly above the table, reusing the existing notice styling
(`rounded-md border px-3 py-2 text-sm text-muted-foreground` — same as the stale-rates line),
so no new design vocabulary:

```
Discretionary bonuses · CA$42,000 · 7 people · 3.1% of current comp     [· CA$18,000 in view]
```

Zero total renders "No discretionary bonuses set yet." Mixed currencies are noted as
converted at current FX; `rates.stale` already has its own banner.

### 8. Commit — surfaced, still not paid

`commit-plan-dialog.tsx` takes the computed totals and adds one sentence ("7 people have a
discretionary bonus proposed, CA$42,000 in total."), and the existing "Compensation is
**not** changed" box is extended to say bonuses aren't paid out by this app either.

**`commitCompensationPlan.ts` is unchanged** — the bonus is already frozen by never being
rewritten after commit, and the ratings-only contract stays intact.

Out of scope (worth a follow-up): `staffEmployment.discretionaryBonus` holds the *actual*
paid bonus, so an `AppliedBadge`-style reconciliation is possible later. The badge stays
about base/rate only.

### 9. Seed + docs

- `scripts/seed/performance.ts` → `seedCompensationPlans`: set `plannedBonus` on a subset
  (leave some null so the empty cell and zero-total states render).
- Dispatch the **librarian** afterwards for `docs/domains/performance.md` (the editor section,
  ~lines 805-930, incl. the column order) and `docs/data-model.md`. No new ADR — this is
  additive to ADR 0046/0051 and leaves ADR 0020 untouched; ask it to append the lump-sum /
  no-unit / derived-% decisions as a note on ADR 0051.

## Verification

```bash
bun run db:generate && bun run db:migrate
bun run db:seed
bun run check     # Biome + tsc + bun test (new money-math cases + the RBAC matrix test)
bun run build
```

Then `bun run dev` on a **draft** plan:

1. Type a bonus → `SaveIndicator` settles to saved; reload → the figure persists.
2. Toggle **CAD / USD** → the bonus cell and the total convert; **Bonus % does not move**.
3. Toggle a row **annual ⇄ hourly** → the bonus and Bonus % **do not move**; Current/Planned do.
4. Clear the field → cell empties, total drops.
5. Confirm **Change, Change %, Gap and Gap % are unchanged** by any bonus edit.
6. Sort by Discretionary bonus and Bonus % → order matches the numbers on screen.
7. Apply a filter → the "in view" subtotal appears; the headline total stays plan-wide.
8. Enter a bonus on a row with **no** planned amount → saves (currency comes from the row);
   the server rejects only when there is genuinely no currency anywhere.
9. Open the commit dialog → bonus total in the copy; commit → plan read-only, bonus renders
   as text, Applied badge still speaks only to base/rate.
