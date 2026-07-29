# 0047 — Plan editor: a status ladder, display-only units, and code-owned level targets

**Status:** accepted · 2026-07-28

## Context

[ADR 0046](./0046-compensation-change-plans-rating-writing-proposals.md) shipped the
compensation-plan editor. Running an actual round through it exposed four gaps, three
of which needed a decision rather than just more UI:

1. **Workflow state was three independent booleans** — `ratingDone`, `meetingDone`,
   `isComplete` — costing three table columns to express one thing, and permitting
   states that mean nothing ("complete" for someone never rated).
2. **Money was locked to one unit per person.** A person's compensation is stored as
   ONE figure whose unit is implied by their employment type (annual base for
   `FULL_TIME`, hourly rate for `HOURLY`). Half the roster is each, so comparing
   them — or checking an hourly proposal against an annual budget — meant mental
   arithmetic. There was no annual↔hourly conversion anywhere in the codebase.
3. **A proposal had nothing to be judged against** except the person's own current
   pay. What we *intend* to pay an L2 Hub Engineer existed only in people's heads,
   so "is this raise right?" could only ever be answered relatively.

(The fourth — no search, filter, or sorting on a grid of dozens of people — was
ordinary UI work and needed no decision. It did force one structural change: because
sorting on Change % or Gap % needs the same derived numbers the cells show, each
row's money math is now computed once in the editor as a `PlanRowView` and handed to
both the cells and the comparator, rather than derived per-cell. Two independent
derivations of FX-and-unit-converted money would inevitably drift.)

## Decision

### 1. One ordered status column, replacing three booleans

`compensation_plan_item.status` is a pgEnum — `NOT_STARTED` → `RATING_DONE` →
`MEETING_DONE` → `COMPLETE` — rendered as a four-segment control. The three boolean
columns are dropped.

The original schema comment claimed the three facts were "deliberately independent of
content — a rating can exist before the meeting happens, and vice versa." In practice
they are not independent: they are one monotone progression through a review
conversation, and the boolean encoding made the nonsense states *representable*
(complete without a rating) rather than merely unlikely. An exclusive column makes
them unrepresentable, and costs one column instead of three — which is precisely the
budget the two new gap columns needed.

**The migration is deliberately lossy.** `drizzle/0010` backfills with highest-set-flag-wins
(`is_complete` → `COMPLETE`, else `meeting_done` → `MEETING_DONE`, …) before `0011`
drops the columns, so a non-monotone combination collapses onto the furthest stage it
implies. Preserving those combinations was never the goal; eliminating them was.

The values live in `@/lib/performance/compensation-plan` per
[ADR 0016](./0016-junction-table-and-shared-enum-conventions.md), with a full label map for
accessible names and a short one (`—` / `Rating` / `Meeting` / `Done`) for the
in-cell segments, mirroring `RubricCategory.short`.

### 2. Annual↔hourly is a fixed convention, and the toggle is display-only

`@/lib/performance/compensation-unit` owns a flat `HOURS_PER_YEAR = 2080` (40 h × 52
w). Each row gets a per-row toggle, surfaced by two affordances — an icon in Current
and one in Planned — that drive **one** unit for the whole row.

**Why a flat constant and not `utilizationTarget`.** Scaling by each person's
utilization would be defensibly more "accurate", but it makes the same dollar figure
convert to a different number per person, so the rate stops being checkable in your
head and starts changing silently when someone's target moves. This is a display
convention, not a costing model.

**Why one unit per row, not one per cell.** Change, Change %, Gap and Gap % are all
subtractions across Current and Planned. If those two could disagree on unit, every
derived column would be a subtraction of unlike quantities — wrong numbers with no
visible symptom.

**Why the persisted value never moves.** The draft holds three fields:
`plannedCanonical` (the truth, always in the person's own unit — what
`plannedAmount` means in the database), `plannedText` (the editing buffer, in the
displayed unit), and `plannedUnit` (display state no patch ever reads). Toggling
re-derives the buffer **from the untouched canonical value** and enqueues nothing.

The rejected alternative — converting the text currently on screen — compounds each
unit's rounding: a 150,000 salary shows as `72.12/hr` and converts back to **150,010**,
silently editing a figure nobody touched and queueing a save for it. That drift is
asserted in `compensation-unit.test.ts` so the simplification can't be reintroduced.

This preserves ADR 0046's invariant that `snapshotEmploymentType` records which figure
a commit compared against: the stored number is always canonical, so a display toggle
can never make an annual base readable as an hourly rate.

### 3. Level compensation targets live in code, keyed role × pool × level

`@/lib/performance/compensation-targets` holds one **annual CAD** figure per (role,
`billableType`, level), FX- and unit-converted for display. Two derived columns follow
Change %:

- **Gap** = `target − planned`. Positive means the proposal is below target.
- **Gap %** = the target increase we'd need minus the increase we're proposing.

**Why code and not a table.** A target is *policy*, revised periodically by human
judgement — not a per-person fact. In code, changing one is a reviewed diff rather
than a migration, it is readable straight from a client component, and it is versioned
with the code that interprets it. Same reasoning as the role rubrics in
[ADR 0042](./0042-per-role-subratings-app-owned-jsonb.md). It is a *reference* only:
[ADR 0020](./0020-compensation-effective-dated-import-only.md) stands, and nothing
here writes pay.

**Why `billableType` is part of the key.** The intended figure for an L1 Engineer
differs sharply between the Hub and Global delivery pools; a single number per (role,
level) would make one of the two columns meaningless. One base currency rather than
five avoids a table that must be kept in step per currency.

**Partial by role, on purpose.** The outer map is `Partial<Record<Role, …>>`, so a role
with no table yields `null` and the columns render an em dash — never a zero, which
would read as "the target is nothing". The inner two dimensions are total, so
configuring a role forces you to state both pools and all five levels. That puts
coverage in the type checker and leaves nothing for a test to assert. Monotonicity is
deliberately not enforced: a flat band across two adjacent levels is a legitimate
policy choice.

**Gap % extends the native-amount doctrine.** ADR 0046 computes `changePercent` from
native amounts, cross-rated through USD, so the display-currency toggle cannot move
it. Gap % does the same and is therefore invariant across the currency toggle *and*
the new unit toggle — restating all three legs in another unit multiplies them by one
shared factor, which cancels in the ratio. It is computed as one division
(`(target − planned) / current`) rather than as the literal difference of two
percentages; the two are exactly equal, and the single form can't be derived
inconsistently. Both invariants are pinned by tests.

**The proposed level drives the lookup**, falling back to the last saved level when the
proposal is still unrated. Committing the plan is what writes the level, so the band
being judged against is the one the person is moving *into*; pairing a new proposal
with last year's band reads the promotion case backwards. The tooltip on the Gap cell
names the target, the level used, whether it was a fallback, and when the table was
last reviewed — otherwise the column is two unattributed numbers.

**Gap columns carry no colour.** `changeTone` paints negatives destructive, which is
right for a pay cut and wrong for "above the level's target". A gap is information to
notice, not a problem to flag.

### 4. A difference of zero is not given a direction

Every signed cell rounds to its display precision *before* choosing a sign, so a
value that shows as zero shows as `CA$0` and `0.0%` — unsigned, and toned as neutral
rather than as a loss.

This is not cosmetic. Comparing across currencies divides and multiplies by FX rates,
so "no change" almost never arrives as exactly `0`; it arrives as `-2.9e-11`. Signing
that rendered `−CA$0` in destructive red: a movement the reader can see and reason
about, that did not happen. `changeTone` therefore takes an
already-display-rounded value, via `displayedAmount` / `displayedPercent`, so colour
and text cannot disagree. Pinned in `plan-format.test.ts`.

The same rounding pass fixed a pre-existing defect: hourly figures were formatted at
zero decimal places and then suffixed, so a `72.50/hr` rate displayed as `CA$73/hr`.
Precision is now a property of the unit (`COMP_UNIT_FRACTION_DIGITS`).

### 5. The page is viewport-height and the table pane owns the scrolling

This route drops the app's usual `max-w-[90rem]` measure and pins itself to
`100svh`, with the grid in a `flex-1` pane that scrolls on both axes under a sticky
header row.

Eleven columns of dense numbers are read *across* — a comfortable reading measure is
the wrong optimisation, and horizontal room is what stops the columns being squeezed.
Fixing the height keeps the filters and the column headers in place instead of letting
them walk off the top of a long plan, which matters once the headers are the sort
controls. The scrolling element is `Table`'s own `[data-slot=table-container]`,
reached by selector from the call site rather than by editing the vendored primitive
(per `docs/ui.md`).

## Consequences

- The column count is unchanged at 11: three checkbox columns out, Status and two Gap
  columns in. Numeric columns are now right-aligned and tabular per `docs/ui.md`,
  which buys back most of the width the new columns cost.
- Status is also a filter, matching the **live draft** value rather than the last-saved
  one — everything else in the grid is draft-driven, and a filter lagging a click
  behind would be the odd one out. Advancing a row's status while filtered to one
  stage therefore drops it out of view, which is the honest reading of "show me
  everyone still at Rating done".
- Filters sit on their own line below the controls, on a grid whose last cell stays
  empty until there is something to reset — so the controls don't shift as you type.
  Pool is segmented (two options plus All is worth showing); Status stays a dropdown,
  since five segments would be unreadably wide.
- **The shipped target figures are placeholders.** Until they are replaced with agreed
  numbers (and `COMP_TARGETS_REVIEWED_ON` is bumped), the Gap columns are a working
  mechanism over fictional data. Only `ENGINEER` is configured; every other role shows
  an em dash.
- `HOURS_PER_YEAR` is load-bearing for the gap columns, not just the toggle: the target
  table is annual, so an hourly person's gap depends on it.
- Sorting is hand-rolled, because `EditableTable`/TanStack renders one `<tr>` per row
  and this table needs two for its expanded panel (ADR 0046). The header button itself
  is shared: `@/components/form/sort-header` owns it, and the TanStack `SortHeader` in
  `admin/table-filters.tsx` is now a thin adapter over it.
- Filtering unmounts rows, so the editor prunes hidden ids from its expanded set and
  flushes them — fire-and-forget, since the textareas are controlled and the debounce
  timers live in the parent queue, so nothing is at risk and typing in the search box
  never waits on the network.
- `compAmountLabel` is deleted (no callers); `COMP_UNIT_LABELS` supersedes it.
- `billableType` moved into the shared `STAFF_FILTER_OPTIONS`. It had been declared in
  `getStaffDirectory.ts`, which is `server-only` and therefore unreachable from any
  client filter bar.
