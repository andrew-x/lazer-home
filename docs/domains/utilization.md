# Domain: Utilization (reporting)

**Status: built (v2).** A read-only report at **`/reporting/utilization`**. It is
**not a new domain in the data-model sense** — no table, no migration, no capability.
It is the only surface that reconciles the **allocation plan** (`project_roles`) against
the **timesheet actuals** (`time_entries`), which both
[allocations.md](./allocations.md) and [timesheets.md](./timesheets.md) previously listed
as unbuilt.

Two ADRs, read in this order:
[ADR 0062](../decisions/0062-utilization-report-two-series-and-timesheet-disclosure.md)
established the report (billable-only cohort, employment-window membership, PTO-beats-a-role,
over-allocation unclamped, the `timesheets.edit` gate), and
**[ADR 0064](../decisions/0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md)
supersedes its §1, §3, §7, §8 and §9** — the two-series-everywhere layout, the own-row
disclosure path, LoB attribution, the tentative-role toggle, the window default and the ◀ ▶
stepping all changed, and the Utilization section became six stat tiles instead of a table.
Where the two disagree, **0064 wins**.

> **The module docstring in `src/lib/utilization/utilization-report.ts` is the
> authoritative statement of every definition.** This doc summarises it and records the
> reasoning; if the two disagree, the code wins.

## Three surfaces say "utilization" — three different questions

Don't unify them, and don't reuse one's number on another's surface
([ADR 0063](../decisions/0063-home-dashboard-two-time-bases-and-point-in-time-staffing.md)):

| Surface | Window | Source | Unit | Gate |
|---|---|---|---|---|
| Home → **Your Status** | **year to date** (1 Jan → today) | your own submitted timesheets (`getStaffUtilization` + `src/lib/timesheets/utilization.ts`) | hours ratio | own data only |
| Home → **Lazer Status** | **today** | the `project_roles` plan (`src/lib/home/org-status.ts`) — no timesheets at all | **people** (staffed ÷ headcount) | open |
| **This report** | a chosen range | plan **and** actuals, computed as two never-summed series but rendered **one basis at a time** | hours | open page; the whole *Logged* basis on `timesheets.edit`, cohort-wide |

`src/lib/timesheets/utilization.ts` is **per-person and cumulative only** — its org-wide
cohort table and suppression machinery were deleted when Lazer Status landed. Anything
measuring the *organization* belongs in `org-status.ts` (point in time) or here (a range);
don't grow a third aggregator in the timesheets module.

## One basis at a time

Every hours-bearing figure is still computed in **both** series — `HoursSeries { planned,
confirmed, variance }` is unchanged — but a **`Planned | Logged` segmented control at the top
of the page picks which one the whole report renders**. Planned is the default.

| Series | Source | Means |
|---|---|---|
| **Planned** | `project_roles` — `hoursPerDay` over the working days a role covers | what we *staffed* |
| **Logged** (`HoursSeries.confirmed`) | `time_entries` on **submitted** timesheets | what people *recorded* |

They are never added together. Showing both at once doubled every column and made the page
unreadable; the *comparison* was what mattered, not the simultaneous display — so the
off-screen series is spent on **deviation flags** instead
([ADR 0064](../decisions/0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md) §1).

Planned hours use the same basis as `roleBillableHours` in `src/lib/projects/project-margin.ts`
(real Mon–Fri weekdays × `hoursPerDay`), so margin and utilization can't disagree about how
long a role is.

**Reading a basis, in code:** `pickBasis(basis, planned, logged)`, plus `hoursFor(series, basis)`
and `shareFor(metric, basis)`. A **`HoursMetric`** is `{ hours: HoursSeries, plannedShare,
confirmedShare }` — a series *plus* each series' share of whatever denominator it has — so one
value drives both an hours figure and a percentage on either basis. It is what the summary's
named split fields carry (see the Utilization card).

### Deviation flags — the other series' job

On the **Logged** basis a figure far enough from its planned counterpart is flagged. A deviation
must clear **both** gates:

- **`DEVIATION_THRESHOLD = 0.2`** — 20% relative (roughly one day a week), *and*
- **`DEVIATION_FLOOR_HOURS = 8`** (`= HOURS_PER_DAY`) — one working day absolute.

Relative alone flags noise on a small plan (4h planned vs 6h logged is a "50% miss"); absolute
alone flags big-but-proportionate numbers. `hoursDeviation(series)` is the signed fraction of
plan; `deviates(series)` applies both gates.

Two renderers, both in `report-primitives.tsx` and **both rendering nothing on the Planned
basis**:

- **`DeviationFlag`** — an inline warning icon + tooltip beside a figure: the staff
  breakdown's hours cells, and three of the Utilization tiles through **`StatCard`'s `marker` slot** (a warning
  marker, never a second figure — see [ui.md](../ui.md)).
- **`DeviationNotice`** — a section-level `InlineNotice tone="destructive"`; used once, in the
  Utilization section, for full-time project hours. Its copy points the reader at coverage
  before they read the gap as time that wasn't worked.

`formatPercentDelta` (in `utilization-format.ts`) renders the gap as whole signed percent
(`−38%`, U+2212 minus).

### `BasisNote` — the caveat that follows the basis

`BasisNote` (which replaced `CoverageNote`) sits above the first card and says what is on screen:

- On **Logged** — the submitted-week coverage line ("24 of 125 person-weeks … 19%"). A
  `timesheets` row is created **lazily**, so a missing week means "not started", not zero; without
  this line a low logged figure is indistinguishable from an unsubmitted one. It also states the
  **flagging rule inline** ("more than 20% *and* 8 hours away from plan"), rendered from
  `DEVIATION_THRESHOLD` / `DEVIATION_FLOOR_HOURS` rather than hardcoded, so a reader meeting their
  first flag doesn't have to guess what earned it.
- On **Planned** — which series is showing (and that tentative roles are excluded), plus, for a
  viewer without timesheet access, **why the Logged basis is unavailable to them**. That sentence
  lives **only** here: the filter bar used to repeat it under the Basis control and no longer
  carries any per-control fine print (see *Filters* below), so `BasisNote` is the single
  explanation of a disabled Logged segment.

## The definitions the numbers depend on

- **Working day** — Mon–Fri. No statutory-holiday calendar, no half-days (matches
  `countWorkingDays` in `src/lib/staff/pto-working-days.ts`).
- **Employment window** — a day counts for a person only when `joinDate <= day <= terminationDate`
  (open-ended when either is null). This is what "adjusted for join and termination dates" means.
- **Available hours** — **full-time only**: employed working days × **8 h**
  (`HOURS_PER_DAY`, **exported** from `src/lib/allocations/allocations-grid.ts` precisely so
  the report's denominator is the same 8 h day the planner calls 100%). **Hourly staff get no
  denominator and no utilization %** — they have no fixed working week — but their project hours
  still count in the totals and now carry their **own measured share** (see the Utilization card).
  Hourly stands in for part-time; the schema has no part-time type.
- **PTO and bench are full-time measures**, on **both** bases. Planned leave books against a
  fixed working week an hourly person doesn't have, so hourly staff contribute no planned *and*
  no logged PTO or bench to those figures — and their per-person PTO/bench cells read **"n/a"**,
  not "0". (Their logged PTO still lands in the line-of-business attribution: it happened.)
- **Cohort = billable staff employed for any part of the window.** Two deliberate filters:
  - **Billable only.** Overhead roles (`NON_BILLABLE_ROLES` — leadership, sales, solutions,
    operations) are excluded from the *whole* report. They hold no project roles, so including
    them only inflates the denominator (measured on seed data: 38% vs 47% planned utilization).
    This is definitional, **not** a filter the reader can toggle.
  - **Not `isActive`.** The importer defines `isActive` as "has no termination date", so filtering
    on it would make the **departures** metric structurally zero and would drop a leaver's capacity,
    roles and hours for the part of the period they were still here.
- **PTO wins over a role on the same day.** A full-timer on approved leave books 8 PTO hours and
  *no* project or bench hours, even if a role covers that day — so planned project + PTO + bench
  equals available hours exactly.
- **…except that over-allocation is not clamped.** Two overlapping full-time roles read as 16 h
  and >100%. The allocations planner deliberately never sums a person's load across projects in
  its *displayed rate* ([ADR 0040](../decisions/0040-allocations-planner-granularity.md)); its
  per-cell capacity meter now does ([ADR 0060](../decisions/0060-allocations-capacity-meter.md)),
  and this report does it over an arbitrary window. Hiding the overflow would defeat the point.
- **Bench day** — a full-time *billable* working day inside the employment window with no
  role and no approved PTO. Streaks run over **working** days: a weekend doesn't break one, a PTO
  day does. `BENCH_STREAK_THRESHOLD = 5`.
- **Which roles count — `confirmed` only.** `tentative` roles are **gone entirely**: the read
  selects `eq(projectRoles.status, ROLE_STATUS.confirmed)`, and `TENTATIVE_WEIGHT`, the
  `includeTentative` input and the "Forecast" switch were all deleted. A tentative role is a
  *forecast*, not an allocation, and with no win-probability field in the schema to weight it by,
  counting it at full weight only made every figure softer than it looked
  ([ADR 0064](../decisions/0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md) §2).
  `UtilizationRole` no longer carries `status`.
- **Internal admin is excluded.** The fourth bucket is gone — the ledger and `LoggedTotals` carry
  exactly **project / PTO / bench** — and `INTERNAL_ADMIN` entries are dropped when folding logged
  totals. It had no planned counterpart, so its row only ever half-filled, and it belongs to no
  practice.

## The seven cards, in render order

All wrapped in the shared `ReportSection` (title + description + a caption carrying the
definitional caveats). **The utilization split leads** — it is the headline the page exists for, and
everything behind it is the context that explains the number.

1. **Utilization** (the headline) — **six stat tiles in a 3-column grid, no table.** In order:
   **Available hours** · **Utilization** · **Part-time project hours**, then **Full-time project
   hours** · **PTO hours** · **Bench hours**.
   - The three full-time split tiles each carry their **share of available hours** in the hint
     (plus `formatPercentDelta(…) vs plan` on the Logged basis) and a **`DeviationFlag` in
     `StatCard`'s `marker` slot**. The section-level `DeviationNotice` still fires once, for
     full-time project hours.
   - **Utilization** *is* full-time project hours ÷ available hours — it reads
     `shareFor(fullTimeProject, basis)`, not a field of its own (see the API note below).
   - **Part-time project hours** carries `hourlyProjectShare` — hourly staff's share of *all*
     project hours — in its hint. Hourly people are otherwise only *excluded* from the
     denominators, never measured.
   - **There is deliberately no total tile.** Project + PTO + bench reconciles to available hours
     by construction, so a total would only add a figure that agrees with itself. Every split tile
     is full-time on both sides, so the two series describe the same population.
   - It used to be four tiles over a `Full-time time | Planned-or-Logged | % available` table
     (project / PTO / bench rows, an **Available / 100%** footer). Under a single basis that table
     carried **one number per row**, which is a stat, not a table.

   **API note — adding a tile here.** `UtilizationSummary` exposes the split as **named
   `HoursMetric` fields**: `fullTimeProject`, `pto`, `bench` (plus `availableHours`,
   `projectHours`, `projectHoursHourly`, `hourlyProjectShare`). `UtilizationSplitRow`,
   `UtilizationSummary.rows`, the old `projectHoursFullTime: HoursSeries` and
   `UtilizationSummary.utilization: { planned, confirmed }` are all **deleted** — that last one was
   exactly `fullTimeProject.plannedShare` / `.confirmedShare`, so it stated the same ratio twice
   and could drift. Read the rate off the metric's share.
2. **Headcount** — total, FT vs hourly, joiners, departures, and the same cut per **role**
   ("Discipline" was renamed *Role* here and in the staff breakdown). The **one card the basis
   toggle doesn't touch**: roster facts have no plan-versus-actual.
3. **Roles** — staffing lines overlapping the period, started/ended in it, average length in
   working weeks, roles per project, and **Projects**: distinct projects *staffed* on Planned,
   distinct projects *with logged time* on Logged. Every other tile describes the plan's own
   shape, so it reads the same either way.
4. **Bench** — staff over the streak threshold, longest/average streak, bench days, average days
   from a joiner's start to their earliest **confirmed** role (which may predate the window —
   hence `firstRoleStartByStaff`, a separate all-time query), unplaced joiners, and one
   basis-following **Bench hours** tile (unstaffed full-time capacity vs. logged
   `UNALLOCATED_BENCH`). Streaks and bench *days* come from the plan on either basis — a
   timesheet records that someone logged bench time, not which consecutive days went unstaffed.
5. **PTO** — approved leave landing in the period, **full-time staff only** (`totalDays`,
   `peopleWithPto`/`peopleWithoutPto`, the record-length stats and the hours all narrow to
   `isFullTime`). `totalDays` is clipped to the range **and** the employment window;
   average/max record length measure the **whole** record (a holiday straddling the edge is still
   that long). The hours tile follows the basis. **No breakdown by leave type, ever** — see
   *Access control*.
6. **Staff utilization breakdown** — one row per person: **Name** (linking to `/staff/{id}`) · Line
   of business · Type · Role · Available · Project · Project % · PTO · PTO % · Bench · Bench %.
   The old *Weeks* column and the Planned/Confirmed/Variance/Planned %/Confirmed % set are gone —
   the basis picks one figure per column. `pto`/`bench` are `HoursMetric | null` (null ⇒ "n/a"
   for non-full-time staff).
   > **Only the display title says "utilization".** The code still says *staff breakdown*
   > throughout — `staff-breakdown-card.tsx`, `StaffBreakdownCard`, `buildStaffBreakdown`,
   > `StaffBreakdownRow`, `report.staffBreakdown`. Renaming six symbols across the math module,
   > the read, the card and its tests is more churn than a display string warrants, and inside a
   > module that is entirely about utilization "staff breakdown" is still accurate shorthand.
   > **This mismatch is deliberate — don't "fix" it.**
7. **Line-of-business alignment** — one row **per person** (it used to be one row per practice):
   Name · Type · Role · Line of business, then **one percentage column per practice**, the
   person's home practice in **bold**, zero rendered as "—". A `sumLobAlignment(rows)` footer
   aggregates the **visible** rows, so the total always describes the table above it rather than
   an unfiltered cohort. See the attribution rule below.

Formatters live in `src/lib/utilization/utilization-format.ts`. **The em dash is load-bearing**:
every formatter renders `null` as "—", and in this report `null` means "you may not read this" or
"there is nothing to average" — never zero.

## Line-of-business attribution — the rule, identical on both bases

This is the least self-evident thing on the page, and it changed:
**both sides now count hours** (the planned side used to count *days* with a "top role wins"
tiebreak), and **leave is attributed to the project someone was staffed to**, not always to their
home practice. It is stated in `buildStaffLedger` (planned) and `buildLoggedTotals` (logged), and
repeated in the card's caption because a reader can't infer it:

| Time | Practice it books against |
|---|---|
| Project time | the line of business of the **project role** that person held |
| Leave taken **while staffed on a project** | that **project's** practice — the client is carrying the cost of the person being away |
| Leave taken while unstaffed | the person's **own** practice |
| Unallocated / bench time | the person's **own** practice — nobody else is carrying it |
| Internal admin | **excluded entirely** |

- **Planned** reads role `hoursPerDay` per covering role, **8 h** for a full-timer's PTO day
  (attributed via `topRoleOn`), and the unstaffed remainder of a full-time day as bench.
- **Logged** reads submitted `time_entries`. Hours booked to a project the person was **never
  staffed to** fall back to their own practice, because **`projects` carries no line of business
  — only its roles do**
  ([ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md)). That
  fallback is the one place the two bases can legitimately disagree, and it is worth reading as a
  signal.

`LobHours = Record<LineOfBusiness, number>` always carries **every** practice (built by an internal
`emptyLobHours()` — not exported), so a row's percentages line up column-for-column across the
table.

## Filters, the two tables, and the window

The filter bar is exactly **date range + line of business + basis** — one control per question a
reader actually asks — laid out as a **single bordered panel** (`rounded border p-4`) with two rows
split by a hairline:

- **Top row, in this order:** the **Date range** group (◀ · start `EndpointPicker` · – · end
  `EndpointPicker` · ▶, `size="icon-sm"` chevrons; the label reads "Date range", not "Period") →
  **Line of business** → **Basis** (the `Planned | Logged` `ToggleGroup`, `size="sm"`).
- **Bottom row:** the four period shortcuts as `size="xs"` buttons on the left, and one short
  caveat line on the right — "An in-progress period runs to today. The arrows step whole periods; a
  hand-picked range slides by its own length."
- **The three per-control fine-print paragraphs are gone.** They left the row ragged and hard to
  scan, and the one that mattered — "Logged hours require timesheet access" — was a duplicate:
  that explanation now lives **solely in `BasisNote`**, which already carried it.
- **Date range → the URL** (`?start=&end=`), because it bounds the server query and a report worth
  reading is worth linking to. Four one-click presets (`RANGE_PRESETS` +
  `RANGE_PRESET_LABELS`): **This month · Last month · This quarter · This year**, resolved by
  `presetRange(preset, today)`; `matchingPreset(range, today)` highlights the active one and a
  hand-picked window matches none.
  - **Period-to-date.** An in-progress month/quarter/year **ends today**, not on its last calendar
    day (`currentMonthRange()` was deleted; the default window is `presetRange("thisMonth")`). A
    window running into the future counts capacity nobody has had the chance to log against yet,
    which makes every logged figure read as a shortfall. "Last month" is complete by definition,
    so it is the whole month.
  - `parseReportRange(start, end, today?, maxDays?)` degrades every invalid/missing/inverted input
    to something sane rather than erroring, and clamps the span to **`MAX_RANGE_DAYS = 366`** by
    default (the read walks day-by-day per person, so an unbounded span pasted into the URL is an
    easy way to make the server work hard; every preset fits inside the cap, leap year included).
    **Renamed from `parseUtilizationRange`, and the whole module moved** to
    `src/lib/reporting/report-range.ts` when the finance report became a second consumer — the
    `maxDays` parameter exists because that report's read is a bounded row query and can afford
    ~3 years ([ADR 0068](../decisions/0068-finance-report-fee-proration-and-server-side-aggregation.md) §9,
    [finance.md](./finance.md)).
  - **`today` is resolved on the server** and passed down as a prop, so the preset highlight can't
    disagree with the window the page defaulted to across a timezone boundary.
  - **The ◀ ▶ buttons step whole calendar periods** — `shiftRange(range, direction, today)`. They
    used to slide by the window's own length, which broke the moment presets became
    period-to-date: on the 3rd of the month the default window is 3 days long, so "previous"
    landed on a 3-day sliver of the previous month instead of on the previous month.
    - Whether a window *is* a calendar period is read off **its own shape** by a private
      `periodUnitOf(range, today)` (month / quarter / year, **smallest unit wins** — early January
      is simultaneously month-, quarter- and year-to-date, and month is what the bar highlights,
      so month is what the arrows step). It accepts either a whole period or one in progress that
      ends today. Deliberately **not** `matchingPreset`: stepping has to keep working once the
      reader has stepped away from the preset that produced the window, and stepping has to be
      **reversible** (back then forward returns you where you started).
    - A stepped period that contains today still **stops at today**; one wholly behind or ahead is
      shown **in full** — stepping forward is how you read the plan ahead.
    - A **hand-picked** window has no period to step, so it keeps sliding by its own length.
    - Seven `shiftRange` tests pin this, including the reversibility property and the original
      3-days-back regression.
- **Basis and line of business → in-memory client state.** Neither changes what has to be fetched:
  the page ships one projection and `buildUtilizationReport` re-derives every card client side.
- **Both per-person tables carry their own search, filters and pagination**
  (`src/components/utilization/staff-table-filters.tsx`): `useStaffTableFilters()` (name search,
  **Type** segmented, **Role** select, page state that **resets to page 1 on any filter change**),
  the `StaffTableFilters` control bar with a "N of M people" count, `paginate()` and
  **`REPORT_PAGE_SIZE = 20`**. Each table owns an **independent** instance — they answer different
  questions. All client-side: the whole cohort is already in one fetched projection, so routing
  these through the URL would re-run the six-query read on every keystroke.
  - `src/components/pagination-controls.tsx` was refactored for this: the strip layout moved into
    a private `PaginationStrip`, with **`PaginationControls`** (link-based, URL state — unchanged
    API, still used by the CRM/projects lists) and a new **`ClientPaginationControls`**
    (`onPageChange` callback) on top.

## Access control

**The page itself is open to any signed-in user** — no capability gate, only the `(app)` layout's
session check (the page `notFound()`s without a user). That is sound because the **Planned** basis
is a re-aggregation of what `getAllocationsGrid` already discloses openly to everyone: staffed
role spans, `hoursPerDay`, line of business, and approved-PTO **dates**. **PTO *type* is never
selected** — it is the one PTO field gated on `pto.review`
([ADR 0038](../decisions/0038-allocations-planner-pto-disclosure.md)) and this report has no need
for it.

**The Logged basis is gated on `timesheets.edit`, cohort-wide — and there is no own-row path.**
Before this feature no signed-in user could read another person's logged hours at all
(`getTimesheetList`/`getTimesheet` fail closed without that capability). Therefore:

- Without `timesheets.edit`, `getUtilizationReport` **skips both timesheet queries entirely** —
  not even the viewer's own rows are fetched, and it no longer resolves `ownStaffId` or scopes
  anything with a SQL predicate. **The gate is the absence of the query.**
- **`canViewLogged: boolean` is the single signal** (the field name on `UtilizationReportData`, on
  `UtilizationInputs`, and on `CoverageSummary`). It replaced `confirmedStaffIds: string[] | null`;
  the per-row `hasConfirmedAccess` flag and the `canSeeConfirmed` predicate are deleted.
- **The Logged toggle is disabled** for such a viewer, with the reason in the filter bar's fine
  print and in `BasisNote`. Their own logged hours remain where they always were, on `/timesheets`.
- Every logged figure is **`null`, never `0`**, all the way to the render — a partial sum presented
  as a total would be a lie, and a zero would be a worse one. That discipline is unchanged.

This only ever **tightens** disclosure relative to
[ADR 0062](../decisions/0062-utilization-report-two-series-and-timesheet-disclosure.md) §3: a
single-basis report showing one person's row and "restricted" everywhere else is worse than not
offering the basis at all.

**No permission-matrix row changed.** Widening the audience would mean adding a **`timesheets.view`**
capability to `src/lib/auth/permissions.ts`, `src/lib/auth/permissions.test.ts` and
[permissions.md](./permissions.md) **in lockstep** ([ADR 0014](../decisions/0014-rbac-better-auth-access-control.md))
— not loosening the scope in this read.

**Nav.** The **Reporting** parent nav entry carries no gate; `staff.viewCompensation` sits on the
Compensation and Bonuses children, **`projects.viewMargin` on the Finance child**
([finance.md](./finance.md)), and Utilization is an **ungated** child. A section is as loose
as its loosest child. `/reporting` (a redirect, not a page) sends `staff.viewCompensation` holders
to Compensation and `ratings.view` holders to Levels, then falls through to
**`/reporting/utilization`** instead of `notFound()` — which is also why neither Profile
completeness nor Finance needs a branch in that ladder: nothing falls through past an ungated
destination. (The section was labelled `Analytics` at `/analytics/*` until 2026-08-03, and
`Dashboards` at `/dashboards/*` before that; neither path redirects.)

## Code map

- **Read:** `src/actions/utilization/getUtilizationReport.ts` (server-only, a **projection not a
  calculator** — no bucketing or percentages happen here). Six queries: staff employed in the
  window, the whole `staff_employment` table folded latest-per-person (`latestEmploymentFirst` +
  `firstPerKey`, the `getAllocationsGrid` shape), staffed **confirmed** roles overlapping the
  window, approved PTO **dates only**, the all-time earliest confirmed role per person, and the
  two `canViewLogged`-conditional timesheet queries. The `projects` join and the unused
  `projectName` field are gone. Re-exports `utilizationFilterOptions = STAFF_FILTER_OPTIONS`,
  now feeding **three** dimensions: `lineOfBusiness` (the cohort), `role` and `employmentType`
  (the two tables).
- **Math:** `src/lib/utilization/utilization-report.ts` — pure, client-importable, one day-level
  `StaffLedger` per person that every card reads from (the weekday spine is built **once** and
  shared across the cohort). `UtilizationRange` is now an **alias** of the shared `ReportRange`
  rather than its own declaration — two structurally identical types would drift into two ideas of
  a window; the name is kept because it reads better at the ~30 call sites here.
  `utilization-report.test.ts` (38 tests) and `report-range.test.ts` (23) are a sanctioned
  [ADR 0037](../decisions/0037-unit-tests-removed-except-rbac-matrix.md) carve-out — they pin the
  access gate's `null`-not-`0` behaviour, the definitions above, the deviation thresholds, the
  LoB attribution rule, the period-to-date presets and whole-period stepping, none of which a type
  states.
- **Window (now shared, not ours):** **`src/lib/reporting/report-range.ts`** — moved out of
  `lib/utilization/` when `/reporting/finance` landed, so both reports agree on what "this quarter"
  means (pure; the `ReportRange` type, params, presets, `shiftRange` + the private `periodUnitOf`,
  period-to-date defaulting, `MAX_RANGE_DAYS = 366` as the **default** cap). **Anything you change
  here changes the finance report too** — including `RANGE_PRESETS`, which is why adding `lastYear`
  was deferred rather than slipped in.
- **Format:** `src/lib/utilization/utilization-format.ts` (pure; the `null` → "—" convention).
  `formatPercentDelta` renders the gap from plan; `formatHoursDelta` was **deleted** when the
  variance columns went, so nothing formats an absolute hours delta any more.
- **UI:** `src/app/(app)/reporting/utilization/page.tsx` (server; `max-w-7xl`, matching the
  projects list, because the breakdown table is wide) → `src/components/utilization/`
  — `utilization-report.tsx` (the client shell; it owns basis + line of business and fixes the
  render order — `utilization` → `headcount` → `roles` → `bench` → `pto` → `staff-breakdown` →
  `lob-alignment`) + seven cards +
  `report-primitives.tsx` (`ReportSection`, `BasisNote`, `DeviationFlag`, `DeviationNotice`) +
  `utilization-filters.tsx` + `staff-table-filters.tsx`.
  **Surface names ≠ code names in one place:** the section titled *Staff utilization breakdown*
  is `staff-breakdown-card.tsx` / `StaffBreakdownCard` / `buildStaffBreakdown` /
  `StaffBreakdownRow` / `report.staffBreakdown` — deliberately, see card 6 above.
- **Shared tile:** `src/components/stat-card.tsx` — `StatCard` gained an optional
  **`marker?: ReactNode`** rendered beside the value, for this report's `DeviationFlag`. It is a
  shared component (home dashboard, the performance dashboards, the plan summaries), so keep the
  slot a *warning marker*, not a second figure.
- **Shared control:** `src/components/form/endpoint-picker.tsx` — `EndpointPicker` was **extracted
  out of `src/components/allocations/planner-range.tsx`** so the planner and this report share one
  bounded date-range endpoint control. Values are `"YYYY-MM-DD"` strings in and out, never `Date`.
- **Seed:** `scripts/seed/staff.ts` — `makeEmployment()` takes an `employmentType`, and **~15% of
  ICs are `HOURLY`**. Every one of the 42 seeded people used to be `FULL_TIME`, which left the
  part-time figures, the "n/a" capacity cells and the Type filter unexercised.

## Known limits

- **The capacity baseline is a flat 8 h × Mon–Fri for full-time staff.** `utilizationTarget`,
  part-time hours/week, joiners/leavers *within* a day and holiday calendars are all unmodelled —
  the same gap the allocations planner's capacity meter has
  ([ADR 0060](../decisions/0060-allocations-capacity-meter.md)). Every figure reads optimistically
  because of it.
- **The seed has only ~4 weeks of timesheet data.** A year-to-date window reads ~3% coverage and
  the Logged basis looks near-empty. That is a data artefact, not a bug — check the coverage line
  in `BasisNote` before concluding anything about the Logged numbers locally.
- **`project_roles` is mutable with no history** ([ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md)),
  so planned utilization for a **past** range reflects the plan **as it stands now**, not as it
  stood then. Re-running last quarter's report after a re-plan gives a different answer.
- **No holiday calendar.** Every Mon–Fri is a working day, so a period containing a statutory
  holiday overstates available hours unless someone booked PTO for it.
- **The timesheet PTO bucket and `staff_pto` are independent** (no sync — see
  [timesheets.md](./timesheets.md)), so planned PTO days and logged PTO hours are two measurements
  of the same thing and are never added together.
- **Nothing is exported and nothing is billed.** No CSV, no per-project or per-client cut, no
  charge rates — the report costs *nobody's* time in money, which is also why it needs no
  `projects.viewMargin`-style gate. The money view of the same window is a **separate, gated
  report** ([finance.md](./finance.md)); keep it that way rather than adding rates here.

## Connects to

- **[Allocations](./allocations.md)** — the Planned basis *is* `project_roles`; the report answers
  that domain's open "how do we reconcile plan against actuals?" and "who is over-allocated?"
  questions in read-only form. It shares `HOURS_PER_DAY` and `EndpointPicker` with the planner.
  Its **line-of-business alignment card has a point-in-time twin**:
  the home dashboard's Borrowed-staff panel names the specific people working outside their home
  LoB *today*, where `buildLobAlignment` gives the day-weighted aggregate over a range. Keep
  both — "how much drift" and "who, right now" are different needs.
- **[Timesheets](./timesheets.md)** — the Logged basis is submitted `time_entries`, and
  `timesheets.edit` is a **read** gate as well as a write gate.
- **[Staff profiles](./staff-profiles.md)** — cohort, billability, employment type, line of business
  and join/termination dates all come from `staff` + the latest `staff_employment`; `staff_pto`
  supplies leave. **`utilizationTarget` is deliberately not read** — the report measures actual
  capacity use, not attainment against a target. No compensation column is read at all.
- **[Finance](./finance.md)** — the sibling report at `/reporting/finance`, and the **only other
  consumer of `report-range.ts`**. It measures the same `project_roles` plan **in money** instead
  of hours, and differs on three axes on purpose: it counts **everything but `cancelled`** (so
  tentative roles carry revenue, where this report dropped them), it aggregates **server-side**
  because a role's cost ÷ its hours is someone's pay rate, and it is **gated on
  `projects.viewMargin`**. The same window can legitimately show different hours on the two pages —
  don't reconcile them.
- **[Performance](./performance.md)** — it sits in the Reporting section beside the three gated
  performance dashboards, and is the only page there open to everyone.
