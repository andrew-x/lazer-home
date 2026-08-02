# 0062 — Utilization report: two never-summed series, cross-person actuals gated on `timesheets.edit`, a billable-only cohort

**Status:** accepted · 2026-08-02 · **no schema change, no migration, no matrix change** ·
first surface to reconcile the `project_roles` plan against `time_entries` actuals, closing
open questions in [allocations.md](../domains/allocations.md) and
[timesheets.md](../domains/timesheets.md) · first surface to **sum a person's load across
projects**, which [ADR 0040](./0040-allocations-planner-granularity.md) deliberately did not ·
inherits [ADR 0038](./0038-allocations-planner-pto-disclosure.md)'s PTO posture verbatim

## Context

The plan and the actuals had existed side by side for weeks and nothing looked at both.
`project_roles` said who was staffed where; `time_entries` said what they logged; the allocations
planner rendered the first as a grid and the timesheet pages rendered the second one person-week at
a time. Nobody could answer "are we 60% utilized or 90%?", "who has been on the bench for a
fortnight?", or "does the plan match what people actually did?" without exporting two tables and
joining them by hand.

Building that report meant settling nine things that a "just divide billable by available" framing
hides — most of them definitional, one of them a genuine access-control decision. **The important
one is §3:** the confirmed series would be the first place in the app where one person can see
another person's logged hours, and the existing timesheet reads fail *closed* on exactly that.

## Decision

Ship a read-only report at **`/dashboards/utilization`**, computed by a pure module
(`src/lib/utilization/utilization-report.ts`) whose **module docstring is the authoritative
statement of every definition** — the read is a projection, not a calculator. The surface is
documented in [domains/utilization.md](../domains/utilization.md); this ADR records the *why*.

### 1. Two series everywhere, and they are never added

Every hours-bearing card carries **planned** (from `project_roles`) and **confirmed** (from
`time_entries` on submitted timesheets), plus a **variance**. One blended number would have to pick
a rule for the overlap — count the plan where no timesheet exists? prefer actuals where they do? —
and every such rule silently answers the exact question the report exists to ask. Keeping them apart
means the gap *is* the finding.

Planned hours use the same basis as `roleBillableHours` in `src/lib/projects/project-margin.ts`
(real Mon–Fri weekdays × `hoursPerDay`), so margin and utilization can never disagree about how long
a role is. `HOURS_PER_DAY` was **exported** from `src/lib/allocations/allocations-grid.ts` (it was
private) rather than re-declared, so the report's denominator is the same 8 h day the planner calls
100% — a second copy of that constant is exactly how two surfaces start disagreeing about full-time.

### 2. Confirmed = submitted timesheets only, always paired with coverage

Draft weeks are excluded: they're still being edited, so counting them would make the number move
under the reader. But a `timesheets` row is created **lazily** ([ADR 0027](./0027-timesheet-weekly-model-and-edit-window.md)),
so an absent week means "not started" — indistinguishable, in a sum, from a week where someone
genuinely logged nothing.

Therefore **every confirmed figure ships with submitted-week coverage** ("24 of 125 person-weeks"):
cohort-wide in `CoverageNote` above the first card, and per person in the Staff breakdown's *Weeks*
column. Coverage is not a nice-to-have caption; without it the headline confirmed utilization is
unreadable, and a reader's first instinct on a low number ("the team is underutilized") is usually
wrong.

### 3. The page is open; the **confirmed series** is gated on `timesheets.edit`

**Open page, no capability.** The `(app)` layout guarantees a session, and the *planned* series is a
re-aggregation of what `getAllocationsGrid` already discloses openly to every signed-in user: staffed
role spans, `hoursPerDay`, line of business, and approved-PTO **dates**. Adding a gate here would be
security theatre over data one click away at `/allocations`. **PTO *type* is deliberately never
selected** — it is the one PTO field behind `pto.review`, and ADR 0038's line (availability is public,
the reason is not) is inherited unchanged.

**Gated series.** The confirmed side is different in kind. Today `getTimesheetList`/`getTimesheet`
**fail closed** without `timesheets.edit`: no signed-in user can read another person's logged hours at
all. A cross-person actuals column would be the first such disclosure in the app, so:

- Entries **and** week-coverage rows are scoped by a **real SQL predicate** to the viewer's own staff
  record unless they hold `timesheets.edit` — **withheld in the read, never serialised**. Not a
  post-filter, not a UI hide: a viewer without the capability never has another person's rows in
  memory. A signed-in viewer with no linked staff record skips both queries entirely rather than
  running one with a predicate contrived to match nothing.
- **`confirmedStaffIds` is the single signal** in the payload (`null` = every one of them; otherwise
  the viewer's own id, or `[]`). The client derives *every* "may I see this" decision from it, rather
  than from a second boolean that could drift out of agreement with the data actually shipped.
- **Cohort-level confirmed figures are withheld entirely — `null`, not `0`** — for a restricted
  viewer, because a partial sum presented as a total would be a lie, and a zero presented as a total
  would be a worse one. Their **own** breakdown row still populates. The `null` survives to the render
  (`HoursSeries.confirmed`, `variance`), where every formatter prints "—"; a genuinely zero figure
  prints "0".

**Reusing `timesheets.edit` as a read gate is deliberate**, and it is the narrower of the two options:
the set of people who may already open and edit anyone's timesheet is exactly the set who may already
see anyone's hours. **No matrix row changed** — `permissions.ts`, `permissions.test.ts` and
[permissions.md](../domains/permissions.md) are untouched, so ADR 0014's lockstep rule is not engaged.
Widening the audience (e.g. letting delivery managers see actuals without letting them edit) means
adding a **`timesheets.view`** capability across those three files in lockstep — **not** loosening the
scope inside this read.

### 4. Billable staff only — a definitional property, not a filter

Overhead disciplines (`NON_BILLABLE_ROLES` — leadership, sales, solutions, operations) are excluded
from the **whole** report, using the same `isBillable` fact the staff importer derives. They hold no
project roles and carry `utilizationTarget = 0` by invariant, so counting them adds capacity that can
never be filled: measured on seed data, including them showed **38% planned utilization against 47%**
for the delivery population — a 9-point swing driven entirely by people the metric doesn't describe.
The report measures **billable capacity**; that is not a checkbox the reader gets to flip, because a
reader who flipped it would be reading a different metric under the same title. (`isBillable` also
**defaults to deny** for a person with no employment row at all.)

### 5. The cohort is "employed for any part of the window", not `isActive`

The staff importer defines **`isActive` as "has no termination date"**. Filtering on it would:
(a) make the **departures** metric structurally always zero — the people it counts are precisely the
ones it would exclude; and (b) drop a leaver's capacity, roles and logged hours for the part of the
period they *were* still here, quietly shrinking both the numerator and the denominator of a past
quarter. So the read takes everyone whose employment window overlaps the range
(`isActive OR terminationDate >= start`, and `joinDate <= end`). Someone who left before the window,
or joins after it, is still correctly excluded.

### 6. PTO wins over a role; over-allocation is **not** clamped

On an approved-PTO working day a full-timer books 8 PTO hours and **no** project or bench hours, even
if a role covers that day. That makes the headline split add up: planned project + PTO + bench =
available hours, exactly. The alternative (counting both) would double-book leave against capacity and
make the split sum to more than 100% for the most ordinary case in the data.

**The one place it doesn't add up is deliberate: over-allocation is not clamped.** Two overlapping
full-time roles read as 16 h and >100%. The allocations planner shows each role's *nominal rate* per
column and never sums a person's load across projects ([ADR 0040](./0040-allocations-planner-granularity.md)),
which is why "how is over-allocation surfaced?" has sat open in allocations.md. This report is the
first surface that sums, and **clamping at 100% would delete the finding** — the row that reads 200%
is the whole reason to look.

### 7. Line-of-business attribution: days for the plan, hours for the actuals

- **Planned** counts **working days**, so shares total 100%: each day defaults to the person's home
  LoB (`staff_employment.lineOfBusiness`) and is reassigned to the LoB of whichever **confirmed** role
  they spend most of that day on. Splitting a day fractionally across roles was rejected — it makes a
  "share of the practice's days" figure that no longer counts days.
- **PTO days sit with the home LoB.** Nobody bills a practice while they're away, and dropping them
  would make the shares stop totalling 100%.
- **Confirmed** counts **logged hours**, attributed through the person's own confirmed role on that
  project **for that date**, falling back to their home LoB when they logged against a project they
  were never staffed to. That fallback is forced by the model: **`projects` has no `lineOfBusiness` of
  its own — only its roles do** ([ADR 0033](./0033-line-of-business-on-role-derived-project-status.md)),
  so there is nothing else to attribute an unstaffed entry to. It is the one place the two columns can
  legitimately disagree, and it is worth reading as a signal.
- **LoB alignment ignores the forecast toggle by design** — it asks where *committed* work sits, so it
  reads confirmed roles whatever the toggle says.

### 8. The forecast toggle includes tentative roles at **full** weight — tiers deferred, not forgotten

`tentative` roles are excluded by default and included at `TENTATIVE_WEIGHT = 1` when the toggle is on.
The requested probability tiers (High 90% / Medium 60% / Low 30%) were **explicitly deferred, because
there is no win-probability field anywhere in the schema** — not on `opportunities`, not on
`project_roles`. Inventing one from pipeline status would be a policy decision smuggled in as a
utilization constant.

The weight is **one named constant**, so tiers land later by turning it into a lookup without touching
any of the math. The toggle affects **only** the Utilization and Staff breakdown cards (the two that
answer "how full are we going to be"); headcount, roles, bench, PTO and LoB alignment are unaffected.

### 9. The window lives in the URL, capped at 366 days

`?start=&end=`, defaulting to the **current calendar month**, because the range bounds the server query
and a report worth reading is worth linking to. `parseUtilizationRange` degrades every invalid, missing
or inverted input to something sane rather than erroring — a mistyped URL should still render a report —
and clamps the span to **`MAX_RANGE_DAYS = 366`**: the read walks day-by-day per person, so an unbounded
range pasted into the URL is a cheap way to make the server do a lot of work.

Everything else is **in-memory client state** over the once-fetched projection: narrowing by line of
business or flipping the forecast toggle re-derives all seven cards client side, because neither changes
what has to be fetched. Prev/next shift by **the length of the current window**, so stepping a calendar
month lands on the month before and an arbitrary 10-day window steps 10 days.

## Consequences

- **`timesheets.edit` is now a *read* gate as well as a write gate.** Anyone auditing that capability
  must count this report. permissions.md and timesheets.md now say so.
- **Planned utilization for a *past* range is not historically faithful.** `project_roles` is mutable
  with no history ([ADR 0017](./0017-project-roles-as-first-allocation-cut.md)), so re-running last
  quarter after a re-plan gives a different answer. This is the most likely thing to mislead a reader
  and is called out in [utilization.md](../domains/utilization.md#known-limits).
- **No holiday calendar.** Every Mon–Fri is a working day, so a period containing a statutory holiday
  overstates available hours unless someone booked PTO for it. Adding one is a data problem
  (which country, which year), not a code problem.
- **`HOURS_PER_DAY` is now part of `allocations-grid.ts`'s public surface.** Changing it moves both the
  planner's 100% mark and this report's denominator — which is the point, but it is no longer a local
  edit.
- **`EndpointPicker` moved to `src/components/form/endpoint-picker.tsx`**, extracted from
  `allocations/planner-range.tsx`. The planner keeps the granularity-aware chevrons around a pair of
  them; this report wraps the same pair in window-length chevrons. Any future bounded date-range control
  should reuse it rather than re-open-code a calendar popover.
- **The Dashboards nav parent is no longer gated**, and `/dashboards` no longer `notFound()`s.
  `staff.viewCompensation` moved down onto the Compensation and Bonuses children; Utilization is an
  ungated child, and the section index falls through to it. A section is now **as loose as its loosest
  child** — the inverse of the note ADR 0055 left there, and the rule to follow when adding a dashboard.
  Compensation remains the landing page for anyone who can see it, so the section doesn't change under
  the people who use it most.
- **34 new tests** (`utilization-report.test.ts` ×26, `utilization-range.test.ts` ×8) are a sanctioned
  [ADR 0037](./0037-unit-tests-removed-except-rbac-matrix.md) carve-out, on the bar that ADR's update
  sets. They pin what no type can state: that a restricted viewer's cohort figures are `null` and not
  `0`, that planned project + PTO + bench equals available hours, that over-allocation is *not* clamped,
  that a PTO day breaks a bench streak and a weekend doesn't, and that the range parser's cap and
  inversion handling hold.
- **No schema change and no seed change.** The report is a read over tables the seed already fills, which
  is how the 38%-vs-47% measurement in §4 was taken.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| One blended "utilization" number (actuals where they exist, plan elsewhere) | The blending rule silently answers the question the report exists to ask; the gap is the finding (§1) |
| Include draft timesheets in the confirmed series | The number would move under the reader as people type; "submitted" is the only stable line (§2) |
| Show confirmed hours cohort-wide to everyone | The first cross-person disclosure of logged hours in an app whose timesheet reads fail closed. Not a call to make inside a report (§3) |
| A new `timesheets.view` capability, shipped with this | A matrix change ([ADR 0014](./0014-rbac-better-auth-access-control.md) lockstep) for an audience nobody had asked for yet; the narrower reuse of `timesheets.edit` gets the report out without widening anything. Recorded as the named path if the need appears (§3) |
| Hide restricted figures in the UI, ship them anyway | Data a client may not see must not reach it — the same rule `getProjectCostBasis` follows for margin ([ADR 0053](./0053-project-budgets-and-margin.md)) (§3) |
| Render withheld figures as `0` | Indistinguishable from "logged nothing", which is the exact confusion coverage exists to prevent (§2, §3) |
| A "include overhead staff" toggle | It would be a different metric under the same title; billable-only is definitional, and the 9-point swing shows how much it matters (§4) |
| Filter the cohort on `staff.isActive` | Makes departures structurally zero and silently drops a leaver's real hours and capacity (§5) |
| Clamp per-person utilization at 100% | Deletes the over-allocation finding — the one thing the planner deliberately can't show (§6) |
| Split a day's LoB fractionally across concurrent roles | Produces a "share of days" that no longer counts days; majority-role attribution keeps the shares at 100% (§7) |
| Attribute confirmed hours by the *project's* line of business | `projects` has no line of business — only its roles do (ADR 0033) (§7) |
| Weight tentative roles by a win probability now | No such field exists in the schema; deriving one from pipeline status is a policy call disguised as a constant (§8) |
| Keep the window in client state | It bounds the server query, and a report you can't link to gets screenshotted instead (§9) |
| Compute the cards in the read (server-side) | Then every filter flip is a round trip; the projection is small and the math is pure, so the client can re-derive (§9, [ADR 0010](./0010-actions-layer-owns-db-access.md) still holds — the read owns all DB access) |
