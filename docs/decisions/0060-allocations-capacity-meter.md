# 0060 — Allocations planner: a per-cell remaining-capacity meter, on a second (prorated, uncapped) load figure

**Status:** accepted · 2026-08-02 · **extends, does not supersede,**
[ADR 0040](./0040-allocations-planner-granularity.md) — its "nominal rate at every zoom"
rule still governs the *blocks*; this adds a second number beside them and is what
reconciles the two · **reuses [ADR 0038](./0038-allocations-planner-pto-disclosure.md)'s
split with nothing new disclosed** · no schema change · **no matrix change**

## Context

`/allocations` could say what each project wants from a person and could say when they are
away, but it could not say **whether they are full.** Every figure in a cell was per-role;
nothing added them up. Two consequences, both live before this change:

- A person on three projects showed three blocks and left the arithmetic to the reader —
  the "sum a person's load across projects / flag over-allocation" open question that
  [domains/allocations.md](../domains/allocations.md) and ADR 0040's last consequence
  bullet both recorded as unbuilt.
- **Availability and load didn't meet.** ADR 0040 made time off a real prorated fraction
  while a role's plan stayed a rate, and the "Away" strip therefore sat *beside* the
  allocation blocks rather than against them. A cell could legibly read **100% booked and
  100% away at the same time** and nothing in the UI called that a problem.

The obvious implementation — sum the percentages already on the blocks — is wrong, and
that is the crux of this record (§3).

## Decision

**Every cell closes with a thin fill bar plus the *remaining*-capacity percentage**
(`CapacityMeter` in `src/components/allocations/allocations-grid.tsx`, fed by a new
`BucketCell.capacity: CapacityCell | null` from the pure
`src/lib/allocations/allocations-grid.ts`). Still a pure view: no table, column, action or
capability was added.

### 1. Capacity is `100 − away`. PTO nets out of it, it doesn't sit beside it

Someone 40% away and 50% booked has **10%** left; someone fully away who is also booked
reads **over-allocated**. This is the behaviour change that supersedes the previous
side-by-side reading — the "100% booked, 100% away" cell now says what it always meant.

ADR 0040's sentence *"availability is a real fraction; a role's plan is a rate"* is
**unchanged and still correct for the blocks**. The meter is the one place the two are
brought into a common unit, which is precisely why it needed its own arithmetic rather
than reading the numbers off the blocks.

### 2. Tentative consumes capacity alongside confirmed

You don't double-sell a person who is pencilled in. `confirmedPercent` and
`tentativePercent` are tracked separately (the bar segments them, the tooltip breaks them
out) but both count against the total. **Paused/cancelled roles do not** — and are not
even fetched (`getAllocationsGrid` filters to `tentative`/`confirmed`); the accumulator
still names both live statuses explicitly, so widening that read can't quietly start
booking dead roles against someone.

### 3. A *second* load function, not a change to the existing one — the month is why

`bucketLoadPercent(role, granularity, colStart)` is a role's real share of a bucket's
working capacity: **uncapped**, **prorated at every granularity**, returning a raw float.
`bucketPercent` (and `weekPercent` under it) are display *rates*: capped at 100, and at
month granularity deliberately not prorated (ADR 0040).

- At **day and week the two agree**, modulo the cap. **Only month diverges** — and it has
  to. A role covering half of March displays its nominal 100% (that is ADR 0040 working as
  designed), so **two back-to-back half-month roles would naively sum to 200%** for a
  person who is exactly full. Prorated, each contributes 50% and the person reads 0% free.
- **`bucketPercent` and `weekPercent` were left untouched.** `weekPercent` is imported by
  `src/lib/projects/project-planner-grid.ts` (the opportunity planner), so editing it to
  serve the meter would have changed a second surface for reasons that have nothing to do
  with it. Adding a function keeps **ADR 0040's "keep both call sites in step"** rule
  intact rather than testing it.

### 4. Round once, at the end, from the raw sum

`buildAllocationRows` accumulates unrounded confirmed/tentative load (and the raw away
share — *not* `timeOff.percent`, which is already rounded) and rounds only when building
the `CapacityCell`. Three 33.3% roles therefore read **"0% free"**, not "1% over" (or
"1% free"). Rounding each part first is the classic way to make a correct total look
broken.

### 5. `capacity` is `null` when the bucket has **no working days**

A Saturday column in the daily view has nothing to report, and "100% free on Saturday"
would be noise on every weekend column of every row. `null` — not a zeroed cell — so the
component simply renders no meter. Every *weekday* cell gets one, including empty ones
(an unbooked person reads "100%"), which is what makes the row scannable for who is free.

### 6. The baseline is a flat 8h/day, 40h/week for everyone

`staff_employment.utilizationTarget` is **still deliberately not used by the planner**, and
this is the second time that has been the right call: the billable invariant in
`src/lib/staff/employment.ts` forces non-billable people to target **0**, so a
target-relative meter would render every overhead role permanently over-allocated. A real
per-person capacity model is where that number belongs, not here (see Consequences).

### 7. UI: colour only for over-allocation, and the number is *remaining*

Track `h-1 bg-muted`, square corners, `overflow-hidden` (so rounding that nudges the
segments past 100% clips rather than widening the bar). Segments in order: confirmed
`bg-primary`, tentative `bg-primary/40`, away `bg-amber-300` (the existing Away strip's
colour), then bare track = the headroom. **Over-allocated is the one state that earns
colour** — the whole bar goes `bg-destructive` and the number reads `-N%` in
`text-destructive` — consistent with the design language's "colour is reserved for genuine
problems" (the same rule `InlineNotice` follows).

The headline number is **capacity left**, i.e. the opposite direction from the load
percentages on the blocks directly above it. That inversion is deliberate (the planner's
job is finding room, and the row sort already orders by soonest-to-free) and is why the
tooltip spells the whole breakdown out: `N% of {day|week|month} free` / `N% over
capacity`, then `N% booked` with the confirmed/tentative split, then `N% away`, plus — at
month granularity only — the line **"Averaged across the month's working days"**, which is
the user-facing explanation for §3.

Two legend entries were added: **Capacity left** and **Over-allocated**. See
[ui.md](../ui.md#allocations--staffing-planner-grid) for the pattern.

### 8. No new disclosure surface, so no permission work

Every input to the meter — allocation percentages, away percentages — was **already
rendered in the same cell to every signed-in viewer**. The meter is arithmetic over data
the reader already had. The only `pto.review`-gated field, the leave **`type`**
(ADR 0038), is not read by any of this. No action, no gate, no
[permissions.md](../domains/permissions.md) change, no `permissions.test.ts` change —
ADR 0014's lockstep rule is not engaged.

## Consequences

- **A month cell can legitimately show two blocks each reading "100%" above a meter
  reading "0% free".** That is not a bug; it is §3 rendered. The tooltip's "averaged across
  the month's working days" line is the only thing standing between that cell and a bug
  report — don't delete it, and don't "fix" the blocks by prorating them (that would be
  reopening ADR 0040).
- **Over-allocation is now *flagged*, but there is still no capacity model.** The flag is
  **per cell only**: nothing rolls a person's window up into a single verdict, nothing
  sorts or filters by free capacity, and the row order still keys off
  `latestConfirmedEnd` — untouched. Forecast-vs-actuals reconciliation against timesheets
  remains entirely unbuilt.
- **Not honoured, unchanged from before:** `staff.joinDate` / `terminationDate` (someone
  terminating mid-window still shows capacity across the whole window), any holiday
  calendar, and part-time contracts (§6). Each of these makes a cell read *more* free than
  the person is, so the meter is optimistic at the edges.
- **A stale-ish figure by construction at month zoom:** an average hides shape. A person
  100% booked for the first half of a month and free for the second reads "50% free" —
  correct as a total, useless as a start date. Days and weeks are where you check that,
  which is what the granularity toggle is for.
- **`bucketLoadPercent` is now the second exported load formula in the file.** If a third
  surface needs a person's real consumed share, import this one; if it needs the *displayed*
  rate, `bucketPercent`. Anyone adding a granularity has to implement both.
- **`allocations-grid.test.ts` grew a `bucketLoadPercent` block and a `capacity` block** —
  a further sanctioned exception under [ADR 0037](./0037-unit-tests-removed-except-rbac-matrix.md)
  (the file was already one). The tests that matter are the ones the type system can't
  express: the two half-month roles summing to exactly 100, thirds summing to 100 rather
  than 99, PTO netting out, and the weekend `null`.
- **First meter/progress bar in the app** — hand-rolled divs, no charting dependency, per
  the hand-rolled-SVG rule in [ui.md](../ui.md#charts-hand-rolled-svg--no-charting-library).
  Copy it before reaching for a library.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Sum the percentages already on the blocks | Two back-to-back half-month roles would total 200% for a person who is exactly full, and a 12h/day role would total 100% because the display rate is capped (§3) |
| Change `bucketPercent`/`weekPercent` to prorate + uncap, and reuse it | `weekPercent` is shared with the opportunity planner (`project-planner-grid.ts`); editing it changes a surface that never asked for this. ADR 0040's dual-call-site rule is preserved by *adding* (§3) |
| Prorate the month **blocks** too, so one number serves both | That is ADR 0040's rejected alternative, unchanged: a "37%" month reads as noise, not capacity. The meter gets the honest number; the block keeps the legible one |
| Keep "Away" purely beside the load, as it was | Leaves the planner unable to say the one thing it exists to say — a fully-away, fully-booked person is the exact case a staffing view must shout about (§1) |
| Count only confirmed roles against capacity | Then a person pencilled in on two deals reads free, and gets sold twice (§2) |
| Scale the baseline by `staff_employment.utilizationTarget` | Non-billable roles carry target 0 by invariant, so every overhead person would read permanently over-allocated (§6) |
| Show **load** (`N% booked`) rather than remaining | The planner's job is finding room; "23% free" answers the question being asked, and the tooltip carries load anyway (§7) |
| Colour-code the fill by band (green/amber/red) | The design language reserves colour for genuine problems; a healthy 60% is not a problem, and a three-colour ramp on every cell of a dense grid destroys the grid (§7) |
| A progress-bar component from a charting/UI library | Two divs and a width; the no-charting-dependency rule holds (Consequences) |
| A per-row or per-window capacity rollup | A different feature — it needs a decision about what "the window" means and how to rank people by it. Deliberately left as an open question, not guessed |
