# Domain: Utilization (reporting)

**Status: built (v1).** A read-only report at **`/analytics/utilization`**. It is
**not a new domain in the data-model sense** — no table, no migration, no capability.
It is the first surface in the app that puts the **allocation plan** (`project_roles`)
and the **timesheet actuals** (`time_entries`) side by side, which both
[allocations.md](./allocations.md) and [timesheets.md](./timesheets.md) previously listed
as unbuilt. See [ADR 0062](../decisions/0062-utilization-report-two-series-and-timesheet-disclosure.md)
for the *why* behind every rule below.

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
| **This report** | a chosen range | plan **and** actuals, as two never-summed series | hours | open page; cross-person *confirmed* on `timesheets.edit` |

`src/lib/timesheets/utilization.ts` is **per-person and cumulative only** — its org-wide
cohort table and suppression machinery were deleted when Lazer Status landed. Anything
measuring the *organization* belongs in `org-status.ts` (point in time) or here (a range);
don't grow a third aggregator in the timesheets module.

## Two series, never summed

Every hours-bearing number on the page carries **both** series plus a variance:

| Series | Source | Means |
|---|---|---|
| **Planned** | `project_roles` — `hoursPerDay` over the working days a role covers | what we *staffed* |
| **Confirmed** | `time_entries` on **submitted** timesheets | what people *logged* |

They are never added together, and the gap between them is the point of the report.
Planned hours use the same basis as `roleBillableHours` in `src/lib/projects/project-margin.ts`
(real Mon–Fri weekdays × `hoursPerDay`), so margin and utilization can't disagree about how
long a role is.

**Confirmed counts submitted timesheets only.** Draft weeks are excluded — they're still
being edited. Because a `timesheets` row is created **lazily**, a missing week means "not
started", not zero, so every confirmed figure is paired with **submitted-week coverage**
("24 of 125 person-weeks"), rendered by `CoverageNote` above the first card and repeated
per person in the Staff breakdown's *Weeks* column. Without that line a low confirmed
number is indistinguishable from an unsubmitted one.

## The definitions the numbers depend on

- **Working day** — Mon–Fri. No statutory-holiday calendar, no half-days (matches
  `countWorkingDays` in `src/lib/staff/pto-working-days.ts`).
- **Employment window** — a day counts for a person only when `joinDate <= day <= terminationDate`
  (open-ended when either is null). This is what "adjusted for join and termination dates" means.
- **Available hours** — **full-time only**: employed working days × **8 h**
  (`HOURS_PER_DAY`, now **exported** from `src/lib/allocations/allocations-grid.ts` precisely so
  the report's denominator is the same 8 h day the planner calls 100%). **Hourly staff get no
  denominator and no utilization %** — they have no fixed working week — but their project hours
  still count in the totals. Hourly stands in for part-time; the schema has no part-time type.
- **Cohort = billable staff employed for any part of the window.** Two deliberate filters:
  - **Billable only.** Overhead disciplines (`NON_BILLABLE_ROLES` — leadership, sales, solutions,
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
  and >100%. The allocations planner deliberately never sums a person's load across projects
  ([ADR 0040](../decisions/0040-allocations-planner-granularity.md)); **this is the first surface
  that does**, and hiding the overflow would defeat the point.
- **Bench day** — a full-time *billable* working day inside the employment window with no included
  role and no approved PTO. Streaks run over **working** days: a weekend doesn't break one, a PTO
  day does. `BENCH_STREAK_THRESHOLD = 5`.
- **Which roles count** — `confirmed` always; `tentative` only when the forecast toggle is on, at
  `TENTATIVE_WEIGHT = 1` (full weight). Line-of-business alignment **ignores the toggle by design**
  — it asks where *committed* work sits.

## The seven cards

All wrapped in the shared `ReportSection` (title + description + a caption carrying the
definitional caveats), in render order:

1. **Utilization** (headline) — available hours, project hours (all / full-time / hourly), and the
   split of full-time time into **project / PTO / bench / internal admin** in both series against
   the same denominator. `internalAdmin` has **no planned counterpart** (the plan has no bucket for
   it), so its planned cell is `null` → empty, not `0`.
2. **Headcount** — the only single-series card (roster facts have no plan-vs-actual): total, FT vs
   hourly, joiners, departures, and the same cut per discipline.
3. **Roles** — staffing lines overlapping the period, started/ended in it, average length in working
   weeks, roles per project, unique projects, and (gated) distinct projects with logged time.
4. **Bench** — staff over the streak threshold, longest/average streak, bench days, average days from
   a joiner's start to their earliest **confirmed** role (which may predate the window — hence
   `firstRoleStartByStaff`, a separate all-time query), unplaced joiners, and (gated) logged
   `UNALLOCATED_BENCH` hours.
5. **PTO** — approved leave landing in the period. `totalDays` is clipped to the range **and** the
   employment window; average/max record length measure the **whole** record (a holiday straddling
   the edge is still that long). **No breakdown by leave type, ever** — see *Access control*.
6. **Staff breakdown** — one row per person: capacity, both series, variance, both utilization
   percentages, and submitted-week coverage. **Per-person gated** (below).
7. **Line-of-business alignment** — where the cohort's time actually sits.
   - *Planned* counts **working days**: each day defaults to the person's home LoB
     (`staff_employment.lineOfBusiness`) and is reassigned to the LoB of whichever **confirmed** role
     they spend most of that day on, so the shares always total 100%. **PTO days sit with the home
     LoB** — nobody bills a practice while they're away.
   - *Confirmed* counts **logged hours**, attributed through the person's own confirmed role on that
     project for that date, falling back to their home LoB when they logged against a project they
     were never staffed to. **`projects` has no `lineOfBusiness` of its own — only its roles do**
     ([ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md)), which is
     why the fallback exists and is the one place the two columns can legitimately disagree.

Formatters live in `src/lib/utilization/utilization-format.ts`. **The em dash is load-bearing**:
every formatter renders `null` as "—", and in this report `null` means "you may not read this" or
"there is nothing to average" — never zero.

## Filters and the window

- **Period → the URL** (`?start=&end=`), because it bounds the server query and a report worth
  reading is worth linking to. `parseUtilizationRange` defaults to the **current calendar month**,
  degrades every invalid/missing/inverted input to something sane rather than erroring, and clamps
  the span to **`MAX_RANGE_DAYS = 366`** (the read walks day-by-day per person, so an unbounded span
  pasted into the URL is an easy way to make the server work hard). The prev/next chevrons shift by
  **the length of the current window**, so "previous" on a calendar month lands on the month before.
- **Line of business and the forecast toggle → in-memory client state.** Neither changes what has to
  be fetched: the page ships one projection and `buildUtilizationReport` re-derives every card client
  side. The forecast toggle affects **only** the Utilization and Staff breakdown cards.
- **No win-probability tiers.** Tentative roles count at full weight because **the schema has no
  win-probability field anywhere**; the requested High 90% / Medium 60% / Low 30% weighting is
  deliberately deferred. `TENTATIVE_WEIGHT` is one named constant so tiers can land later by making
  it a lookup, without touching the math.

## Access control

**The page itself is open to any signed-in user** — no capability gate, only the `(app)` layout's
session check (the page `notFound()`s without a user). That is sound because the **planned** series
is a re-aggregation of what `getAllocationsGrid` already discloses openly to everyone: staffed role
spans, `hoursPerDay`, line of business, and approved-PTO **dates**. **PTO *type* is never selected**
— it is the one PTO field gated on `pto.review`
([ADR 0038](../decisions/0038-allocations-planner-pto-disclosure.md)) and this report has no need
for it.

**The confirmed series is gated on `timesheets.edit`.** Before this feature no signed-in user could
read another person's logged hours at all (`getTimesheetList`/`getTimesheet` fail closed without that
capability), so a cross-person actuals column would have been the first such disclosure. Therefore:

- Entries **and** week-coverage rows are scoped by a **real SQL predicate**
  (`eq(timesheets.staffId, viewerStaffId)`) unless the viewer holds `timesheets.edit` — withheld in
  the read, never serialised to a client that merely hides it. A signed-in viewer with **no linked
  staff record** skips both timesheet queries outright.
- **`confirmedStaffIds` is the single signal.** `null` = "all of them"; otherwise it is the viewer's
  own id and nothing else (or `[]`). The client derives every "may I see this" decision from it
  rather than from a second boolean that could disagree.
- **Cohort-level confirmed figures are withheld entirely** for a restricted viewer — `null`, never
  `0`, all the way to the render, because a partial sum presented as a total would be a lie. Their
  **own** Staff-breakdown row still populates; everyone else's confirmed cells read "restricted".

**No permission-matrix row changed.** Widening the audience would mean adding a **`timesheets.view`**
capability to `src/lib/auth/permissions.ts`, `src/lib/auth/permissions.test.ts` and
[permissions.md](./permissions.md) **in lockstep** ([ADR 0014](../decisions/0014-rbac-better-auth-access-control.md))
— not loosening the scope in this read.

**Nav.** The **Analytics** parent nav entry lost its `staff.viewCompensation` gate; that gate moved
down onto the Compensation and Bonuses children, and Utilization was added as an **ungated** child.
A section is now as loose as its loosest child. `/analytics` (still a redirect, not a page) keeps
sending `staff.viewCompensation` holders to Compensation and `ratings.view` holders to Levels, then
falls through to **`/analytics/utilization`** instead of `notFound()` — so the section is finally
reachable by everyone.

## Code map

- **Read:** `src/actions/utilization/getUtilizationReport.ts` (server-only, a **projection not a
  calculator** — no bucketing or percentages happen here). Six queries: staff employed in the window,
  the whole `staff_employment` table folded latest-per-person (`latestEmploymentFirst` + `firstPerKey`,
  the `getAllocationsGrid` shape), staffed `tentative`/`confirmed` roles overlapping the window,
  approved PTO **dates only**, the all-time earliest confirmed role per person, and the two
  scope-dependent timesheet queries. Re-exports `utilizationFilterOptions = STAFF_FILTER_OPTIONS`
  so the page never imports the Drizzle schema.
- **Math:** `src/lib/utilization/utilization-report.ts` — pure, client-importable, one day-level
  `StaffLedger` per person that every card reads from (the weekday spine is built **once** and shared
  across the cohort). `utilization-report.test.ts` (26 tests) and `utilization-range.test.ts` (8) are
  a sanctioned [ADR 0037](../decisions/0037-unit-tests-removed-except-rbac-matrix.md) carve-out —
  they pin the access gate's `null`-not-`0` behaviour and the definitions above, which no type states.
- **Window:** `src/lib/utilization/utilization-range.ts` (pure; params, current-month default, cap).
- **Format:** `src/lib/utilization/utilization-format.ts` (pure; the `null` → "—" convention).
- **UI:** `src/app/(app)/analytics/utilization/page.tsx` (server) → `src/components/utilization/`
  — `utilization-report.tsx` (the client shell owning the two in-memory filters) + seven cards +
  `report-primitives.tsx` (`ReportSection`, `CoverageNote`) + `utilization-filters.tsx`.
- **Shared control:** `src/components/form/endpoint-picker.tsx` — `EndpointPicker` was **extracted out
  of `src/components/allocations/planner-range.tsx`** so the planner (which wraps a pair of them in
  granularity-aware chevrons) and this report share one bounded date-range endpoint control. Values
  are `"YYYY-MM-DD"` strings in and out, never `Date`.

## Known limits

- **`project_roles` is mutable with no history** ([ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md)),
  so planned utilization for a **past** range reflects the plan **as it stands now**, not as it stood
  then. Re-running last quarter's report after a re-plan gives a different answer.
- **No holiday calendar.** Every Mon–Fri is a working day, so a period containing a statutory holiday
  overstates available hours unless someone booked PTO for it.
- **The timesheet PTO bucket and `staff_pto` are independent** (no sync — see
  [timesheets.md](./timesheets.md)), so planned PTO days and logged PTO hours are two measurements of
  the same thing and are never added together.
- **Nothing is exported and nothing is billed.** No CSV, no per-project or per-client cut, no charge
  rates — the report costs *nobody's* time in money, which is also why it needs no
  `projects.viewMargin`-style gate.

## Connects to

- **[Allocations](./allocations.md)** — the planned series *is* `project_roles`; the report answers
  that domain's open "how do we reconcile plan against actuals?" and "who is over-allocated?"
  questions in read-only form. Its **line-of-business alignment card has a point-in-time twin**:
  the home dashboard's Borrowed-staff panel names the specific people working outside their home
  LoB *today*, where `buildLobAlignment` gives the day-weighted aggregate over a range. Keep
  both — "how much drift" and "who, right now" are different needs.
- **[Timesheets](./timesheets.md)** — the confirmed series is submitted `time_entries`, and
  `timesheets.edit` is now a **read** gate as well as a write gate.
- **[Staff profiles](./staff-profiles.md)** — cohort, billability, employment type, line of business
  and join/termination dates all come from `staff` + the latest `staff_employment`; `staff_pto`
  supplies leave. **`utilizationTarget` is deliberately not read** — the report measures actual
  capacity use, not attainment against a target.
- **[Performance](./performance.md)** — it sits in the Analytics section beside the three gated
  analytics pages, and is the only one open to everyone.
