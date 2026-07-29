# Compensation change plan — editor overhaul

## Context

The compensation-plan editor (`/performance/compensation-plans/[planId]`) shipped in #66 as a
single unsorted, unfiltered grid: rows arrive `asc(staff.name)` and that is the only order you
get. Workflow state is three independent checkbox columns, the money columns are locked to
whichever unit the person's `employmentType` implies, and there is nothing to compare a proposal
*against* except the person's own current pay.

Running an actual comp round exposes four gaps:

1. **Navigation** — a round covers dozens of people. You need to find one by name, and to work
   a slice at a time (all Hub engineers, all Fintech designers). Sorting by change % or by who
   is furthest below target is how you sanity-check a round before committing it.
2. **Workflow state** — "rating done", "meeting done" and "complete" are not three orthogonal
   facts, they are one progression. Three checkboxes let you tick Complete without a rating and
   cost three columns to say one thing.
3. **Units** — half the roster is salaried and half hourly. Comparing them, or sanity-checking
   an hourly proposal against an annual budget, means doing ×2080 in your head.
4. **A reference point** — a proposal is only judgeable against what we *intend* to pay an L2
   Hub Engineer. That target exists in people's heads and nowhere in the system.

Outcome: the editor becomes a workable review surface — searchable, filterable, sortable, with a
single status control, per-row annual/hourly display, quick percentage bumps, and a
code-maintained level target driving two gap columns.

**Column count is unchanged at 11**: three checkbox columns come out, one Status and two Gap
columns go in. No density concession is needed at `max-w-[90rem]`.

---

## Decisions taken (asked and answered)

| Decision | Choice |
|---|---|
| Status model | **Exclusive pgEnum column**; drop `ratingDone`/`meetingDone`/`isComplete` |
| Hourly↔annual basis | **Fixed 2080 h/yr** constant in a pure module |
| Target config keying | **role × billableType (HUB/GLOBAL) × level**, one annual figure, base currency CAD |
| Unit toggle scope | **Per row** |

One thing the questions did not cover, decided here: a row has **one** unit, surfaced by **two**
affordances (an icon in Current, an icon in Planned) that both drive the same state. Letting
Current and Planned disagree would make Change, Change %, Gap and Gap % subtractions of unlike
units — silently wrong numbers. Stated so the implementer does not "fix" it into two independent
toggles.

---

## Invariants this must not break

- **`planChangePercent` works from native amounts** so the display-currency toggle cannot move
  the percentage — pinned by two tests in `src/lib/performance/compensation-plan.test.ts`. The
  new Gap % must respect the same rule *and* be invariant under the new unit toggle.
- **`plannedAmount` is one number whose unit is implied by `employmentType`**, and
  `snapshotEmploymentType` records which figure a commit compared against. The unit toggle is
  display-only; the persisted value stays canonical. See Phase 4 for how drift is eliminated
  rather than merely bounded.
- **Rippling is the sole writer of `staffEmployment`** (ADR 0020). Targets are a reference, never
  a write.
- Flat design, hairline borders, `p-2` cells, `tabular-nums` on numbers, `<EmptyCell />` for
  missing values — never NaN or 0.

---

## Phase 1 — Pure modules (no UI)

### 1a. `src/lib/performance/compensation-unit.ts` (new)

Client-importable, header-commented like its siblings.

```ts
export const HOURS_PER_YEAR = 2080;               // 40h × 52w — the one place to change it
export const COMP_UNITS = ["ANNUAL", "HOURLY"] as const;
export type CompUnit = (typeof COMP_UNITS)[number];
export const COMP_UNIT_LABELS: Record<CompUnit, string>;   // "Annual" / "Hourly"
export const COMP_UNIT_SUFFIX: Record<CompUnit, string>;   // "" / "/hr"

/** The unit a person's stored comp figure is denominated in. */
export function canonicalUnit(employmentType: EmploymentType | null): CompUnit;
export function toUnit(amount: number, from: CompUnit, to: CompUnit): number;
/** ANNUAL → whole dollars, HOURLY → 2dp. Both fit numeric(12,2). */
export function roundForUnit(amount: number, unit: CompUnit): number;
export function otherUnit(unit: CompUnit): CompUnit;
```

Delete `compAmountLabel` from `compensation-plan.ts` — it has no callers and
`COMP_UNIT_LABELS` supersedes it.

### 1b. `src/lib/performance/compensation-targets.ts` (new)

```ts
export const COMPENSATION_TARGET_CURRENCY: Currency = "CAD";
export const COMPENSATION_TARGET_UNIT: CompUnit = "ANNUAL";
/** Bump when the table below is revised. Surfaced in the editor's tooltip copy. */
export const COMPENSATION_TARGETS_REVIEWED_ON = "2026-07-28";

type LevelTargets = Record<RatingLevel, number>;   // keys 0–4, exhaustive
export const COMPENSATION_TARGETS: Partial<
  Record<Role, Record<BillableType, LevelTargets>>
>;

/** null for any (role, billableType, level) with no entry, or an unrated level. */
export function compensationTarget(
  role: Role | null,
  billableType: BillableType | null,
  level: number | null,
): number | null;
```

- Populate `ENGINEER` and `DESIGNER` for HUB and GLOBAL. **The figures are placeholders** —
  flag this in the PR body and to me; I need to supply the real numbers.
- Partial by role, mirroring how `ROLE_RUBRICS` is honestly partial. Unconfigured → `null` →
  both Gap cells render `<EmptyCell />`.
- Test (`compensation-targets.test.ts`): every configured role covers both billable types and
  all five levels (`RATING_LEVELS`), and figures are monotonically non-decreasing by level.
  The `Record<RatingLevel, number>` type already makes level coverage a compile error;
  the test catches the ordering mistake typing cannot.

### 1c. `src/lib/performance/compensation-plan.ts` (extend)

Add the per-item status tuple next to the existing plan-status tuple, so it feeds the pgEnum
per ADR 0016:

```ts
export const PLAN_ITEM_STATUSES = [
  "NOT_STARTED", "RATING_DONE", "MEETING_DONE", "COMPLETE",
] as const;
export type PlanItemStatus = (typeof PLAN_ITEM_STATUSES)[number];
/** Accessible/full labels. */
export const PLAN_ITEM_STATUS_LABELS: Record<PlanItemStatus, string>;
/** Segment labels for the in-cell control: "—" / "Rating" / "Meeting" / "Complete". */
export const PLAN_ITEM_STATUS_SHORT: Record<PlanItemStatus, string>;
```

(The `label` + `short` pair mirrors `RubricCategory` in `rating-rubric.ts`.)

Add `planGap` beside `planChange`:

```ts
export type PlanGap = {
  /** Target restated in displayCurrency and displayUnit, or null. */
  target: number | null;
  /** target − planned, in displayCurrency + displayUnit. Positive = below target. */
  gapAmount: number | null;
  /** targetIncrease% − change%, as a fraction. Currency- and unit-invariant. */
  gapPercent: number | null;
};
export function planGap(input: PlanGapInput): PlanGap;
```

`gapPercent` is computed from **native** amounts, exactly as `planChangePercent` is:
convert the CAD-annual target into the person's own currency and canonical unit, then

```
gapPercent = (targetNative − plannedNative) / currentNative
```

cross-rating through USD when currencies differ. This is algebraically
`(target/current − 1) − (planned/current − 1)` — the literal "target increase % minus current
change %" the requirement asks for — but computed as one division so no float noise creeps in
and so a future edit cannot make the display toggles move it. Unit conversion is a pure ×2080
scalar that cancels in the ratio, which is why the number is unit-invariant too.

`null` when `currentAmount` is null or 0, or when target or planned is missing.

Extend `compensation-plan.test.ts` with two tests mirroring the existing pinned pair:
switching display currency does not move `gapPercent`, and switching display unit does not
move `gapPercent`.

---

## Phase 2 — Schema, migration, seed

### `src/lib/db/performance-schema.ts`

```ts
export const compensationPlanItemStatusEnum = pgEnum(
  "compensation_plan_item_status", [...PLAN_ITEM_STATUSES],
);
```

On `compensationPlanItem`: add `status: compensationPlanItemStatusEnum().notNull().default("NOT_STARTED")`,
**remove** `ratingDone`, `meetingDone`, `isComplete`. Replace the "Workflow tracking …
deliberately independent of content" comment — the new column asserts the opposite (a single
ordered progression), and the comment must say so.

### Migration

`bun run db:generate` → `bun run db:migrate`. **Hand-edit the generated SQL** to backfill
before the drops, as its own `--> statement-breakpoint` step:

```sql
UPDATE "compensation_plan_item" SET "status" = CASE
  WHEN "is_complete"  THEN 'COMPLETE'
  WHEN "meeting_done" THEN 'MEETING_DONE'
  WHEN "rating_done"  THEN 'RATING_DONE'
  ELSE 'NOT_STARTED' END;
```

Order: create type → add column with default → backfill → drop the three booleans.

### `scripts/seed/performance.ts`

Set `status` instead of the three booleans (it imports the real Drizzle tables, so a stale seed
fails `bun run check`). Spread values across all four statuses so the segmented control has
something to show.

---

## Phase 3 — Reads, writes, and the shared `describe()`

### `src/actions/performance/getCompensationPlan.ts`

- Select `staffEmployment.billableType`; add `billableType: BillableType | null` to
  `CompensationPlanEditorItem`.
- Replace the three booleans on the item type with `status: PlanItemStatus`.

### `src/actions/performance/getStaffForCompensationPlan.ts`

Also select `billableType` — needed by the shared `describe()` (below).

### `src/actions/performance/saveCompensationPlanItem.schema.ts`

Replace the three boolean patch fields with `status: z.enum(PLAN_ITEM_STATUSES).optional()`.
Keep the file drizzle-free (client components import it).

### `src/actions/performance/compensationPlanWrites.ts` + `commitCompensationPlan.ts`

`buildPlanItems` drops the boolean defaults (the column default covers it). Audit
`commitCompensationPlan` for any read of the three booleans and switch to `status`; the
completeness *warning* is derived in the editor, not enforced server-side, so this should be a
projection change only — verify rather than assume.

### Kill the duplicated `describe()`

It exists verbatim in `plan-row.tsx:363` and `manage-plan-staff.tsx:289` over two different row
types. Extract one helper — `describeStaffMeta()` in
`src/components/performance/compensation-plans/plan-format.ts` — taking a structural param
`{ lineOfBusiness, role, employmentType, billableType, location }`, and add the Hub/Global
segment via `BILLABLE_TYPE_LABELS`. Both call sites use it, satisfying requirement 2 in the plan
grid and picking up the same meta line on the staff-roster page for free.

Not in scope: adding a Hub/Global filter to `manage-plan-staff.tsx`. Worth doing later now that
the field is loaded; say so rather than doing it.

---

## Phase 4 — The row model (the load-bearing refactor)

Making *every* column sortable means the comparator needs the derived numbers (change %, gap %),
which today are computed inside `PlanRow`. Duplicating that math in a comparator would guarantee
drift. So compute it once, in the parent.

New `src/components/performance/compensation-plans/plan-row-model.ts`:

```ts
export type PlanRowComputed = {
  item: CompensationPlanEditorItem;
  draft: PlanRowDraft;
  /** Display currency for this row (existing resolveDisplayCurrency). */
  target: Currency | null;
  /** The row's display unit, and the unit its stored figure is in. */
  unit: CompUnit;
  canonicalUnit: CompUnit;
  change: PlanChange;   // already restated in `unit`
  gap: PlanGap;
  /** The level the target lookup used, for the tooltip. */
  targetLevel: number | null;
};

export function computePlanRow(args: {...}): PlanRowComputed;
```

`plan-editor.tsx` maps `plan.items` → `PlanRowComputed[]`, then filters, then sorts, then
renders. `PlanRow` receives `computed` and does no money math of its own.

### The unit toggle, without drift

`PlanRowDraft` gains three fields:

| field | role |
|---|---|
| `plannedUnit: CompUnit` | the unit the input text is expressed in — display state |
| `canonicalUnit: CompUnit` | from `employmentType`; seeded once, never edited |
| `plannedCanonical: number \| null` | **the truth**: the value that gets persisted |

`plannedAmount` stays what it is today — the raw editing buffer, so typing `"1200."` still
doesn't fight the draft.

- `patchFor("planned")` returns `{ plannedAmount: draft.plannedCanonical, plannedCurrency }`.
  It reads only the draft, so `fieldEqual`'s patch comparison stays valid.
- Editing the input: `plannedAmount = typed`, and
  `plannedCanonical = roundForUnit(toUnit(parse(typed), plannedUnit, canonicalUnit), canonicalUnit)`.
- Toggling the unit: a **new `setRowUnit(itemId, unit)` on `usePlanAutosave` that updates the
  draft without calling `touch`**. It recomputes the buffer *from the canonical value*:
  `plannedAmount = fmt(toUnit(plannedCanonical, canonicalUnit, unit), unit)`.

Why this shape and not the obvious one: if the toggle converted the *displayed text* instead,
a 150,000 annual figure would render as 72.12/hr and convert back to 150,010 — a $10 drift, and
worse, an enqueued save of a number nobody typed. Deriving the buffer from the untouched
canonical value makes the round trip exact and the toggle a genuine no-op against the server.

`draftFromItem` seeds `canonicalUnit` from `item.employmentType`, `plannedUnit = canonicalUnit`,
`plannedCanonical = item.plannedAmount`, and `plannedAmount` as today.

### Status field

`PlanRowDraft.status: PlanItemStatus` replaces the three booleans. In `use-plan-autosave.ts`:
`PlanField` swaps the three entries for `"status"`; add it to `IMMEDIATE_FIELDS` and
`ALL_PLAN_FIELDS`; `patchFor` gains a `status` case.

---

## Phase 5 — Sorting and filtering

### `src/components/form/sort-header.tsx` (new)

`SortHeader` in `src/components/admin/table-filters.tsx` is coupled to a TanStack `Column`
(`column.getIsSorted()`, `column.toggleSorting()`), and this table is deliberately not TanStack
(see the comment at `plan-editor.tsx:38`). Add a plain-props sibling:

```ts
export function SortButton({
  active, dir, onClick, children,
}: { active: boolean; dir: "asc" | "desc"; onClick: () => void; children: ReactNode }): ReactElement;
```

Same markup, classes and `IconChevronUp`/`IconChevronDown`/`IconSelector` treatment as today.
Then refactor the existing TanStack `SortHeader` to render `SortButton` internally, so the
visual definition lives in exactly one place.

### `plan-sort.ts` (new, component-local)

```ts
export type PlanSortKey =
  | "name" | "rating" | "current" | "planned"
  | "changeAmount" | "changePercent" | "gapAmount" | "gapPercent" | "status";
export type PlanSort = { key: PlanSortKey; dir: "asc" | "desc" };
export function comparePlanRows(a: PlanRowComputed, b: PlanRowComputed, sort: PlanSort): number;
```

- Nulls sort **last in both directions** (the "empty → —" rule extended to ordering: a missing
  proposal is not "the smallest one").
- Status sorts by its index in `PLAN_ITEM_STATUSES`, so the order is the progression.
- Every comparison falls back to `name` ascending, so the order is stable and re-renders don't
  shuffle equal rows.
- Default sort: `{ key: "name", dir: "asc" }` — preserves today's behaviour.

### `plan-columns.ts`

- Drop the dead `align` property (declared, never read).
- Add `sortKey?: PlanSortKey` per entry, so the header row derives both label and sortability
  from the one array that already guards the `colSpan`.
- New key order: `expand, name, rating, current, planned, changeAmount, changePercent,
  gapAmount, gapPercent, status, applied` — still 11, so `PLAN_COLUMN_COUNT` is unchanged.
- `expand` and `applied` stay unsorted (`sortKey` omitted). There is deliberately **no**
  `billableType` sort key: Hub/Global has no column of its own (it lives in the name meta line),
  and a sort key with no header to click is dead code. Grouping by Hub/Global is what the filter
  is for.

### `plan-filters.ts` (new, component-local)

```ts
export type PlanFilters = {
  search: string;
  lineOfBusiness: LineOfBusiness | typeof ALL;
  role: Role | typeof ALL;
  billableType: BillableType | typeof ALL;
};
export const EMPTY_PLAN_FILTERS: PlanFilters;
export function matchesPlanFilters(item: CompensationPlanEditorItem, f: PlanFilters): boolean;
export function hasActivePlanFilters(f: PlanFilters): boolean;
```

Case-insensitive substring match on `item.name`. Reuse the `ALL` sentinel from
`src/components/form/filters.tsx`.

### Toolbar in `plan-editor.tsx`

A second row beneath the existing display-currency toggle, mirroring
`performance/edit-levels.tsx`'s in-memory bar (`flex flex-wrap items-end gap-6`):

- Search: the established idiom — absolutely-positioned `IconSearch` + `Input type="search"
  className="pl-9"` inside `relative max-w-sm`, with a `FilterLabel`/`Label`.
- Three `SelectFilter`s: Line of business (`LINE_OF_BUSINESS` + `LINE_OF_BUSINESS_LABELS`),
  Role (`STAFF_FILTER_OPTIONS` + `ROLE_LABELS`), Hub/Global (`BILLABLE_TYPE_LABELS`).
- A ghost "Clear filters" button when `hasActivePlanFilters`.
- When filters hide every row, an `EmptyState` distinct from the existing "No staff in this plan
  yet" copy — the empty table already has a meaning and must keep it.
- Show `visible.length` of `plan.items.length` when filtered, so a filtered commit can't be
  mistaken for the whole round.

### Expanded rows vs. filtering

Rows are keyed by `itemId`, so filtering unmounts them. Pending saves live in the parent queue
and survive unmount, so no data is lost — but leaving ids in the `expanded` set means a row
silently re-expands when the filter is cleared. On any filter change: compute the next visible
set, `await flushRow(id)` for each expanded id that drops out (a no-op on clean rows, matching
the existing collapse path), and prune it from `expanded`. Sorting reorders rather than unmounts,
so it needs none of this.

---

## Phase 6 — Cells

### `plan-row.tsx`

- **Name cell**: `describeStaffMeta(item)` — now carries Hub/Global.
- **Current cell**: amount in `computed.unit` + `COMP_UNIT_SUFFIX[unit]`, plus an `IconButton`
  (`IconArrowsExchange`, `size="icon"`, label `Show ${otherUnit} equivalent for ${item.name}`)
  calling `onUnitChange(otherUnit(unit))`. `IconButton` already enforces tooltip + aria-label.
- **Planned cell**: `PlannedCompField` gains the same swap `IconButton` and the quick-select row.
- **Change / Change %**: unchanged code path, now fed restated-in-unit values.
- **Gap amount**: `formatChangeAmount(gap.gapAmount, target)` — reuses the signed formatting and
  U+2212. **No `changeTone`.** `changeTone` paints negatives destructive, which is right for a
  pay cut and wrong for "above target". A gap is information, not a warning; leave it
  uncoloured. Add a `Tooltip` naming the reference:
  `Target CA$120,000 · L2 Engineer (Hub) · reviewed 2026-07-28`, and note when `targetLevel`
  fell back to `item.lastLevel`.
- **Gap %**: `formatChangePercent(gap.gapPercent)`, uncoloured, `<EmptyCell />` when null.
- **Status cell**: replaces the three `CheckCell`s. Delete `CheckCell`.
  ```tsx
  <ToggleGroup variant="outline" spacing={0} size="sm"
    aria-label={`Status for ${item.name}`} value={[draft.status]}
    onValueChange={(v) => { if (v.length > 0) onFieldChange("status", { status: v[0] as PlanItemStatus }); }}>
    {PLAN_ITEM_STATUSES.map((s) => (
      <ToggleGroupItem key={s} value={s} aria-label={PLAN_ITEM_STATUS_LABELS[s]}>
        {PLAN_ITEM_STATUS_SHORT[s]}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
  ```
  The `values.length > 0` guard is mandatory — Base UI emits `[]` when the active segment is
  re-pressed. Keep it compact with `text-xs` and tight horizontal padding at the call site
  (never by editing `src/components/ui/**`).

### Target level

Lookup uses `decodeLevelValue(draft.level)` — the **proposed** level, since committing the plan
is what writes it — falling back to `item.lastLevel` when the proposal is still unrated, so the
columns are useful before anyone touches the Rating select. The tooltip states which was used.

### `planned-comp-field.tsx`

- New props: `unit`, `canonicalUnit`, `onUnitChange`, `quickBase`, `onQuickSelect`.
- `step` follows `unit` (0.5 hourly / 1000 annual) rather than `employmentType`.
- Quick-select row under the input:
  ```ts
  export const PLANNED_QUICK_STEPS = [0, 0.02, 0.03, 0.04, 0.05] as const;
  ```
  Rendered as small `Button variant="ghost" size="sm"` (`h-6 px-1.5 text-xs`) labelled
  `+0% … +5%`. Each sets planned from the *current* figure:
  1. base = `convert(item.current.amount, item.current.currency, draft.plannedCurrency, usdRates)`
     — native, therefore already in `canonicalUnit`;
  2. `plannedCanonical = roundForUnit(base * (1 + p), canonicalUnit)`;
  3. buffer = `fmt(toUnit(plannedCanonical, canonicalUnit, plannedUnit), plannedUnit)`;
  4. `onFieldChange("planned", …)` then `onFieldCommit("planned")` — a discrete click should not
     wait out the 600 ms debounce.

  Hidden when `readOnly`, or when `item.current.amount == null` / no `plannedCurrency` — there is
  nothing to take a percentage of. `+0%` is deliberately included: "match current, no raise" is a
  real decision and currently requires retyping the salary.
- Update the doc comment: the display-**currency** toggle still never re-denominates this input,
  but the display-**unit** toggle now does — losslessly, via the canonical value.

### `plan-expanded-panel.tsx`

- Remove the `Current on file` `Fact`. Remaining three (Joined / Last evaluation / Previous
  change) → `sm:grid-cols-2 lg:grid-cols-3`.
- Subrating `SelectTrigger`s get `className="w-full"`. Keep the
  `sm:grid-cols-2 lg:grid-cols-4` grid — full width means full width *of its grid cell*.

### `plan-editor.tsx`

`incompleteCount` becomes `plan.items.filter((i) => autosave.draftFor(i).status !== "COMPLETE").length`.
It must count **all** items, not the filtered view — the commit dialog is about the whole plan.

---

## Phase 7 — Docs

Write **ADR 0047** covering the three decisions with real alternatives:

- one ordered per-item status enum replacing three independent booleans (and why the progression
  is the truer model);
- display-unit toggling with canonical persistence, the 2080 constant, and why the buffer is
  derived from the canonical value rather than converted in place;
- code-defined level compensation targets keyed role × billableType × level in CAD annual, why
  they live in code rather than the DB (they change quarterly by human judgement, not per-tenant),
  and the gap-% native-amount invariant.

Then dispatch the **`librarian`** subagent with a summary to reconcile `docs/domains/performance.md`
and `docs/ui.md` (the segmented-control-in-a-cell and sortable-hand-rolled-table patterns are both
new precedents worth recording). Do not hand-write `/docs`.

---

## Files at a glance

**New**
- `src/lib/performance/compensation-unit.ts`, `compensation-targets.ts`, `compensation-targets.test.ts`
- `src/components/form/sort-header.tsx`
- `src/components/performance/compensation-plans/plan-row-model.ts`, `plan-sort.ts`, `plan-filters.ts`
- `drizzle/0010_*.sql` (hand-edited to backfill), `docs/decisions/0047-*.md`

**Modified**
- `src/lib/performance/compensation-plan.ts` (+`.test.ts`), `src/lib/db/performance-schema.ts`
- `src/actions/performance/`: `getCompensationPlan.ts`, `getStaffForCompensationPlan.ts`,
  `saveCompensationPlanItem.schema.ts`, `compensationPlanWrites.ts`, `commitCompensationPlan.ts`
- `src/components/performance/compensation-plans/`: `plan-editor.tsx`, `plan-row.tsx`,
  `plan-columns.ts`, `plan-expanded-panel.tsx`, `planned-comp-field.tsx`, `plan-format.ts`,
  `use-plan-autosave.ts`, `manage-plan-staff.tsx`
- `src/components/admin/table-filters.tsx` (delegate to `SortButton`)
- `scripts/seed/performance.ts`

No changes to `src/lib/auth/permissions.ts`. `COMPENSATION_PLAN_ACCESS` already gates every
surface touched here, and no new capability is introduced — targets and gaps are derived from data
the caller is already cleared to read.

---

## Verification

1. `bun run db:generate` → inspect the SQL, add the backfill → `bun run db:migrate` → `bun run db:seed`.
2. `bun run check` (Biome + `tsc --noEmit` + `bun test`) — must be green, including the new
   target-config and gap-invariant tests.
3. `bun run build`.
4. `bun run dev`, open a **draft** plan as a manager and confirm:
   - search by partial name; each of the three filters; combined; Clear filters; the filtered
     empty state; the "N of M" count;
   - click every sortable header through asc → desc; rows with no proposal sort last in both
     directions; the order is stable across an unrelated edit;
   - Hub/Global appears in the name meta line (and on the Manage-staff page);
   - the Status control: set each of the four stages, confirm the save indicator settles, reload
     and confirm persistence, and confirm re-pressing the active segment does not clear it;
   - unit swap on a **salaried** row: Current flips to `/hr`, Planned converts, Change/Change %/
     Gap all restate; toggle back and confirm the Planned figure returns to the **exact** original
     (this is the drift test) and that no save fires on a bare toggle;
   - same on an **hourly** row;
   - quick-select `+0/2/3/4/5%` sets Planned from Current, in whichever unit is showing, in both
     the same-currency and cross-currency (CAD→USD) cases;
   - Gap amount/Gap % against a configured (role, Hub/Global, level); the tooltip names the
     target and level; switch display currency **and** display unit and confirm Gap % does not
     move; an unconfigured role shows em dashes;
   - expanded panel: no "Current on file", three facts, subrating selects fill their cells;
   - expand a row, edit its notes, then apply a filter that hides it — reload and confirm the
     notes saved;
   - commit dialog's incomplete count reflects non-`COMPLETE` items across the **whole** plan
     while a filter is active.
5. Open a **committed** plan and confirm read-only: no toggles, no quick-selects, no status
   control, and the Applied badge still renders.
6. `/code-review` before merging.

## Revisions after design review

A second design pass verified the plan against the code and found six things worth changing.
These supersede the corresponding text above.

1. **`commitCompensationPlan` and `buildPlanItems` need no change** — verified: the former selects
   only `id, staffId, level, subratings`, the latter relies on column defaults. Phase 3's "audit
   and switch" is resolved to "confirmed no-op". The only readers of the three booleans are
   `plan-editor`, `plan-row`, `use-plan-autosave`, `manage-plan-staff`, `getCompensationPlan`,
   `saveCompensationPlanItem{,.schema}`, the seed and the schema.

2. **Sort keys must be normalized to annual USD.** Under `DEFAULT` each row displays its own
   currency, and canonical amounts mix $/yr with $/hr — so sorting on the displayed or canonical
   number compares CAD against USD *and* annual against hourly. `PlanRowComputed` carries
   `sort: { currentAnnualUsd, plannedAnnualUsd, changeAnnualUsd, gapAnnualUsd, changePercent,
   gapPercent, rating, status, name }`, where money keys are
   `toUnit(canonical, canonicalUnit, "ANNUAL") / usdRates[currency]`. The comparator reads *only*
   these, so order can never disagree with a cell. Percent columns are already unit- and
   currency-free.

3. **`billableType` filter options are unreachable from a client component.** They exist only in
   `getStaffDirectory.ts`, which is `server-only`. Add
   `billableType: [...billableTypeEnum.enumValues]` to `STAFF_FILTER_OPTIONS`
   (`src/lib/staff/staff-filters.ts`, client-safe) and have `staffDirectoryFilterOptions` stop
   redeclaring it.

4. **Pre-existing rounding bug, fixed in passing.** The Current cell, the `≈` echo and the panel's
   "Current on file" all format with `maximumFractionDigits: 0` and then append `/hr`, so an
   hourly rate of 72.50 renders `CA$73/hr`. A unit-aware `formatUnitMoney(amount, currency, unit)`
   in `plan-format.ts` (0 digits annual, 2 hourly) fixes every call site at once;
   `formatChangeAmount` takes `unit` as a third argument.

5. **`PLAN_COLUMNS.align` is rehabilitated, not deleted.** Replace it with `numeric?: true` that
   *is* read (`TableHead` gets `text-right`) plus an exported `PLAN_NUMERIC_CELL =
   "text-right tabular-nums whitespace-nowrap"` used by the cells. This brings the table in line
   with `docs/ui.md`'s number-cell rule and buys back most of the width the new columns cost.
   Planned stays left-aligned — it holds an input.

6. **The hidden-expanded-row flush is fire-and-forget, not awaited.** The panel's `Textarea` is
   fully controlled and the debounce timer lives in the parent queue, so unmounting a dirty row
   loses nothing — the existing `await flushRow` on collapse is a save *indication*, not a rescue.
   So prune `expanded` in an effect keyed on the visible set and call `void flushRow(id)` without
   awaiting; otherwise every keystroke in the search box would block on the network.

Also dropped: the monotonicity test in `compensation-targets.test.ts`. Making the inner records
total (`Record<BillableType, Record<RatingLevel, number | null>>` under a `Partial` by role) puts
coverage in the type checker, and a flat band across two adjacent levels is legitimate — so there
is nothing left for a test to assert. No new test file.

## Open item for you

The figures in `COMPENSATION_TARGETS` are placeholders. The Gap columns are only as good as that
table — send me the real per-level targets for Hub and Global (and which roles beyond Engineer and
Designer to cover) and I'll fill them in.
