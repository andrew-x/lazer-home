# Home dashboard — real widgets

## Context

`src/app/(app)/page.tsx` is still the scaffold: a greeting, four hardcoded stat cards whose value
is literally `"—"`, and a "Getting started" card explaining that domain dashboards will land here
later. `docs/ui.md` acknowledges it as placeholder. Every domain it promised now exists —
allocations, timesheets, PTO, staff employment — so the home page can become what it claims to be:
a glance surface that answers "what am I on, and how is the org tracking" without navigating
anywhere.

**The framing is point-in-time.** This is a snapshot of the consultancy as it stands today, not an
analytics page. Utilization is *this week*. PTO is *taken so far, plus what's booked*. The only
forward-looking widgets are the two that are inherently forecasts and were asked for as such:
availability at +1..+4 weeks, and upcoming leave.

Eight widgets in two sections. **Your work** (own data, no gate): active projects, an allocation
timeline, PTO taken this year, this week's utilization planned vs actual. **The organization**
(visible to every signed-in user, matching the deliberately-ungated `/allocations` precedent):
this week's utilization split full-time vs hourly, availability now/+1/+2/+3/+4 weeks with the
bench list folded in, and upcoming time off.

The outcome is a home page worth landing on, built almost entirely on reads and pure math that
already exist — 3 new queries for the whole page.

### Decisions already taken

| Question | Decision |
|---|---|
| "Role timeline" | **Project allocations over time**, not employment history |
| Utilization period | **The current week** — a snapshot, not a year aggregate |
| Utilization basis | **Both** planned (allocation) and actual (timesheet), side by side |
| Org section gate | **Everyone signed in**; PTO *reason* still masked behind `pto.review` |
| Bench vs availability | **Merged into one card** — "free now" is bucket 0 of the strip |
| "Available" | **≥50% spare capacity** that week, net of confirmed load and PTO |
| Tentative work | Does **not** commit a person — still counts as free, badged |
| PTO | **Blocks** availability; the tile shows taken **and** booked |
| Non-billable staff | **Excluded** from utilization / bench / availability, exclusion stated |
| Part-time | `staff_employment.employmentType = 'HOURLY'` |
| Allocation timeline window | Centred on now: **−1 month → +2 months**, not a forward projection |

---

## Definitions to lock in

Put each in the docblock of the function that owns it.

**The week** is `currentWeekStart()` from `src/lib/timesheets/timesheet-week.ts` — the same ISO
Monday `timesheets.weekStartDate` is keyed on. Every utilization figure on the page is labelled
with it ("week of Jul 27").

**Actual utilization** — `projectHours / (totalHours − ptoHours)` for that week's timesheet.
Billability is structural, not a flag: `time_entries.projectId IS NOT NULL` ⇒ billable; a non-null
`category` ⇒ not. `UNALLOCATED_BENCH` and `INTERNAL_ADMIN` stay in the denominator — they are
unutilized capacity, which is the whole point. PTO comes out.

Dividing by *logged* hours is what makes this work mid-week: on Tuesday, someone who logged 16h
with 16h on projects is 100%, not 40%. The partial week normalizes away. Drafts are counted
necessarily — the current week's timesheet is almost always a draft.

**Planned utilization** — `allocatedHours / (nominalHours − ptoHours)` for the same week, where
`allocatedHours` sums `hoursPerDay × active weekdays in the week` over **confirmed** roles
(tentative excluded, consistent with availability below), `nominalHours = 8 × 5`, and `ptoHours =
8 × approved-PTO weekdays` from `staff_pto`. Unclamped — a genuinely over-allocated person plans
above 100% and the number must say so.

The two denominators differ in kind: actual divides by *hours recorded*, planned by *the week's
calendar capacity*. That's not a defect to reconcile — they answer different questions ("of what
you logged, how much was billable" vs "how much of your week is committed"). For anyone logging a
full week they coincide. Label the columns and footnote it; never blend them.

**Nobody has logged yet** — actual is `null` → `"—"`, hint "Nothing logged yet this week". Early
in the week that will be common, and it's honest (plus a useful nudge). Do **not** fall back to
the last week with data; a silently-shifting period makes the number unexplainable.

**Currently active project** — a `project_roles` row with `staffId = me`, `status IN
('tentative','confirmed')`, `startDate <= today <= endDate`. Same predicate `getAllocationsGrid`
and `getTimesheetPrefill` already use; don't invent a third. Multiple concurrent roles all show,
sorted by descending current-week load. Two roles on one project merge into one entry summing
`hoursPerDay`. A delivery-manager seat with no role row counts as active when today falls inside
the project's live-role window, with `loadPercent: null` — never a fabricated percentage.

**Available in week W** — `freePercent = max(0, 100 − confirmedPercent − awayPercent) >= 50`,
where `confirmedPercent` sums `weekPercent()` over **confirmed** roles (capped at 100) and
`awayPercent = awayWeekdays / 5 × 100` over approved PTO. The threshold is an exported named
constant so it is arguable rather than buried. Counts include a person in *every* week they're
free (that's what "who's free in three weeks" means); the *name lists* key each person to their
**first** free week so nobody is listed twice.

**Population** for utilization, bench and availability — active staff (`staff.isActive`) whose
latest `staff_employment` row has `isBillable = true`. Filter on the employment fact, not
`isBillableRole(role)` — the latter is only the CSV importer's derivation and is overridable
in-app. People with no employment row go in an explicit "unknown" count, never defaulted to
`FULL_TIME`.

---

## Architecture

Reads live in **domain folders**, not a `src/actions/home/` — availability is an allocations
concept and utilization is a timesheets concept, and a `home/` folder becomes the drawer the next
dashboard's math also lands in. Only the timeline's *pixel geometry* is genuinely home-specific,
so `src/lib/home/` holds exactly that one module.

Five of eight widgets need **no new query**. `getAllocationsGrid()` already returns active staff +
latest employment + live role spans + approved PTO **with the `pto.review` type-masking applied
inside it** — reusing it wholesale is the highest-leverage call here, because a second read means
a second place that disclosure rule can drift.

| # | Widget | Source | New query? |
|---|---|---|---|
| 1 | Active projects | `getMyAllocations` | yes (shared with 2) |
| 2 | Allocation timeline | `getMyAllocations` | shared |
| 3 | PTO taken + booked | `getStaffPto(me)` — reuse | no |
| 4 | My utilization this week | `getStaffUtilization(me)` | yes |
| 5 | Org utilization this week | `getOrgUtilization()` | yes |
| 6+7 | Availability + bench | `getAllocationsGrid()` — reuse | no |
| 8 | Upcoming time off | `getAllocationsGrid()` — reuse | no |

Scoping to one week is what keeps this cheap: both utilization reads filter on
`timesheets.weekStartDate = $week`, which hits the existing `unique(staffId, weekStartDate)` index
rather than scanning a year of entries.

---

## Files

### New reads — `import "server-only"`, plain async, exported return type

**`src/actions/allocations/getMyAllocations.ts`**
```ts
export type MyAllocationRole = { roleId, projectId, projectName, companyName, roleType,
  status, description, startDate, endDate, hoursPerDay };
export type MyManagedProject = { projectId, projectName, companyName,
  liveStart: string | null, liveEnd: string | null };   // min/max over the project's live roles
export type MyAllocationsView = { staffId: string | null; roles: MyAllocationRole[];
  managedProjects: MyManagedProject[] };
export async function getMyAllocations(): Promise<MyAllocationsView>;
```
`getCurrentStaffId()` (already `React.cache`d) → empties on `null`. Then `Promise.all` of two
queries: `projectRoles ⨝ projects ⨝ companies` for me in live statuses overlapping the timeline
window; and `projectDeliveryManagers ⨝ projects ⨝ companies` left-joined to that project's live
roles, grouped, selecting `min(startDate)`/`max(endDate)`. **Takes no `staffId` parameter** —
own-data-only by construction, so there is no cross-user id to authorize and no gate to get wrong.
Explicit column projection throughout (`.claude/rules/database.md`).

**`src/actions/timesheets/getStaffUtilization.ts`**
```ts
export type StaffUtilization = { weekStart: string;
  hours: HoursRow | null;     // null = no timesheet logged this week
  plan: PlanRow };
export async function getStaffUtilization(staffId: string, weekStart: string): Promise<StaffUtilization>;
```
Three small queries in a `Promise.all`, all single-week: the timesheet aggregate for
`(staffId, weekStart)` reusing the three-bucket `CASE WHEN` shape already written in
`getTimesheetList.ts:60-74` verbatim; my confirmed `project_roles` overlapping the week; my
approved `staff_pto` overlapping the week. Own-scoped: if `staffId !== await getCurrentStaffId()`,
require `timesheets: ["edit"]` and otherwise return an empty result — the same self-scoping shape
`getStaffPto` and `getTimesheetList` use.

**`src/actions/timesheets/getOrgUtilization.ts`**
```ts
export type UtilizationRecord = {              // identity-free — no staffId, no name
  employmentType: EmploymentType | null; utilizationTarget: number;
  hours: HoursRow | null; plan: PlanRow };
export type OrgUtilizationData = { weekStart: string;
  records: UtilizationRecord[];                // one per active + billable person
  nonBillableExcluded, withoutEmployment: number };
export const getOrgUtilization = cache(async (weekStart: string): Promise<OrgUtilizationData> => …);
```
Five queries: active staff ids; `staffEmployment` ordered by `latestEmploymentFirst` folded with
`firstPerKey` (projecting `employmentType`, `isBillable`, `utilizationTarget`); the timesheet
aggregate grouped by `timesheets.staffId` for that one week; confirmed `project_roles` overlapping
the week; approved `staff_pto` overlapping the week. Joins them per person **inside the function**,
then emits identity-free records. **`staffId` never leaves** — this is a surface everyone can see,
so it follows the identity-free precedent in `src/actions/performance/getBonusSummaryData.ts`,
whose docblock explains why shipping a joinable id to an aggregate view is a leak. (Planned
utilization needs per-person role data joined to per-person hours, so the join must happen here
rather than in the pure layer — that is precisely what keeps the ids from leaving.)

### Modified reads

**`src/actions/allocations/getAllocationsGrid.ts`** — add `isBillable: staffEmployment.isBillable`
to the employment projection and `isBillable: boolean | null` to `AllocationStaffRow` (additive,
no client breaks). Wrap the export in `React.cache` — it now has two callers and takes no
arguments. While here, collapse its four sequential queries into a `Promise.all`.

### New pure modules — client-importable (no `db`, no drizzle, no React), each with a `.test.ts`

**`src/lib/allocations/weekdays.ts`** — lift `activeWeekdays`, `totalWeekdays`, `awayWeekdays` out
of `allocations-grid.ts` (import them back) and export `latestConfirmedEnd`. Mechanical; the
untouched `allocations-grid.test.ts` staying green *is* the regression check.

**`src/lib/timesheets/utilization.ts`**
```ts
export type HoursRow = { projectHours: number; ptoHours: number; totalHours: number };
export type PlanRow  = { allocatedHours: number; nominalHours: number; ptoHours: number };
export type Rate = { numerator, denominator: number; rate: number | null }; // 0–1; null if denom 0
export type UtilizationSummary = { actual: Rate; planned: Rate };

/** Allocated hours one confirmed role contributes to one ISO week. */
export function allocatedHoursInWeek(role, weekStart): number;
/** A person's plan row for one week — 8h × 5 weekdays, less approved PTO. */
export function buildPlanRow(roles, ptoSpans, weekStart): PlanRow;

export function computeUtilization(
  hours: readonly (HoursRow | null)[], plan: readonly PlanRow[]): UtilizationSummary;

export type UtilizationGroup = { key: EmploymentType | "UNKNOWN"; headcount, logged: number;
  summary: UtilizationSummary; weightedTarget: number | null };
export function splitByEmploymentType(records: readonly UtilizationRecord[]):
  { overall: UtilizationGroup; groups: UtilizationGroup[]; headcount, logged: number };
```
`rate` is a 0–1 fraction so `formatPercent()` (`src/lib/format/format.ts:27`) consumes it
directly, including its `null → "—"` case. Aggregation is **sum-then-divide** (hours-weighted), so
one person's 4-hour week can't outvote a colleague's 40-hour week; a mean of per-person ratios is
the tempting bug. `allocatedHoursInWeek` uses `activeWeekdays` from `weekdays.ts` — the same
clamped-weekday count `weekPercent` uses, so a week's planned *hours* and the planner's displayed
*percent* can never disagree. (`roleBillableHours` in `src/lib/projects/project-margin.ts` is the
whole-span equivalent; it isn't week-clamped so it can't be reused directly — cross-reference it
in the docblock so the two stay conceptually paired.) `weightedTarget` is a
**capacity-hours-weighted** mean of `utilizationTarget`, like-for-like with the numerator.

Tests: a full-PTO week contributes `0/0` to both rates, not 0%; a mid-week partial log
(16h logged, all billable) is 100% actual, not 40%; bench/admin hours stay in the actual
denominator; `hours: null` is excluded from actual but still counted in headcount and still has a
plan; sum-then-divide beats mean-of-ratios on a mixed cohort; planned exceeds 100% for two
concurrent full-time roles and is **not** clamped; a role overlapping only part of the week
contributes proportional hours; a role that ended before the week contributes nothing; empty
cohort → `rate: null`.

**`src/lib/allocations/availability.ts`**
```ts
export const AVAILABILITY_WEEKS = 5;                  // now + 4
export const AVAILABLE_THRESHOLD_PERCENT = 50;
export type WeekLoad = { weekStart, confirmedPercent, tentativePercent, awayPercent, freePercent };
export type AvailabilityPerson = { staffId, name, role, lineOfBusiness, employmentType,
  weeks: WeekLoad[]; freeFrom: string | null; tentativeOnly: boolean };
export type AvailabilityWeek = { weekStart; availableCount, tentativeCount: number;
  freeFte: number };                                  // Σ freePercent / 100
export function buildAvailability(staff, roles, timeOff, fromWeek):
  { weeks: AvailabilityWeek[]; people: AvailabilityPerson[] };
export type UpcomingLeave = { staffId, name, startDate, endDate, workingDays,
  type: PtoType | null, startsInDays: number };
export function buildUpcomingTimeOff(staff, timeOff, today, horizonDays): UpcomingLeave[];
```
Reuses `weekPercent` + `latestConfirmedEnd` from `allocations-grid.ts`, the weekday helpers from
`weekdays.ts`, `countWorkingDays` from `src/lib/staff/pto-working-days.ts`, and
`currentWeekStart`/`addWeeks` from `src/lib/timesheets/timesheet-week.ts`. `buildUpcomingTimeOff`
passes `type` straight through — already masked by the read, **never re-derived here**. `freeFte`
is the number a staffing lead acts on ("3.4 FTE spare next week"); five half-free people and five
fully-free people are very different weeks.

Tests: 0% allocated + full-week PTO ⇒ not available; exactly 50% free ⇒ available (boundary);
tentative-only counted available and flagged; a person free in weeks 0 and 3 appears in both
*counts* but has `freeFrom` = week 0; two 100% roles ⇒ `freePercent` 0, never negative;
non-billable excluded; upcoming PTO respects the horizon and preserves a `null` type.

**`src/lib/home/allocation-timeline.ts`** — layout geometry only.
```ts
export const TIMELINE_MONTHS_BACK = 1;
export const TIMELINE_MONTHS_FORWARD = 2;
export const TIMELINE_MAX_ROWS = 6;
export function timelineWindow(today): { start, end, months: { label, pct }[] };
export function pctOf(date, window): number;          // clamped 0–100; used by bars AND ticks
export function layoutRow(role, window):
  { leftPct, widthPct, clippedStart, clippedEnd } | null;   // null = fully outside
export function buildTimelineRows(roles, today, window): { rows: TimelineRow[]; hiddenCount: number };
```
Window is **centred on now** — first day of last month through the last day of month +2, four
months total, with today sitting about a quarter in. That matches the point-in-time framing:
enough past to see what just ended, enough future to see what's next, without turning the widget
into a forecast. It's deterministic, so axis labels are always clean month names and it's
trivially testable. Bars and ticks share `pctOf()`, so a tick can never drift from a bar edge.
Guard the degenerate cases: `widthPct >= MIN_BAR_PCT` (a one-day role must still be visible) and
never negative (a bad-import `startDate > endDate`). Row order: current (spanning today, load
desc) → upcoming (`startDate` asc) → recently ended in-window (`endDate` desc, muted), capped at
`TIMELINE_MAX_ROWS`.

**`src/lib/staff/pto-year.ts`**
```ts
export type PtoYearSummary = { takenDays, bookedDays, pendingDays: number;
  byType: { type: PtoType; days: number }[] };
export function summarizePtoYear(spans, year, today): PtoYearSummary;
```
Clamps each span to `[yearStart, yearEnd]` **and** splits at `today`, counting with
`countWorkingDays`. Deliberately **not** `getStaffPto`'s existing `summary`, which lumps pending in
with approved and counts future bookings as taken — "PTO **taken**" must mean days actually used,
with booked and pending beside it. Feed it the concatenated `upcoming` + `past` spans `getStaffPto`
already returns; no new query.

### Component move

**`src/components/performance/stat-card.tsx` → `src/components/stat-card.tsx`.** It already has a
non-performance consumer today — `src/components/projects/plan-summary-tiles.tsx:13` imports it
from `performance/`, which is an actively misleading path. Home makes it three domains. The repo
has the precedent: `DataTable` moved `admin/` → `src/components/data-table.tsx` and the filter
controls moved to `src/components/form/filters.tsx` for exactly this reason.

No re-export shim — update all four import sites (`compensation-dashboard.tsx:15`,
`levels-dashboard.tsx:13`, `bonus-breakdown.tsx`, `plan-summary-tiles.tsx:13`). Also fix the
docblock: it currently says "Extracted from the Home dashboard's inline pattern so the performance
dashboard … share one stat tile", which goes circular the moment Home imports it.

### New components — `src/components/home/`, **all Server Components**

There is no client state in v1, and that is the recommendation rather than a compromise: a
granularity toggle would be a worse copy of what `/allocations` already owns, and a bucket
selector would hide four-fifths of what the count strip shows for free. Every "more" affordance is
a link to the page that owns the interaction. Net client bundle for the route: zero.

- **`home-section.tsx`** — `{ title, description?, children }`; `<h3>` + description over a
  `border-b pb-3`. Not tabs (hides half a glance surface behind state), not nested `Card`s
  (`Card` already carries its own hairline ring).
- **`allocation-timeline.tsx`** — `{ rows, window, todayPct, hiddenCount }`. See below.
- **`utilization-panel.tsx`** — `{ weekStart, overall, groups, headcount, logged }`. The org
  planned-vs-actual table.
- **`availability-panel.tsx`** — `{ weeks, freeNow, freeingUp, freeNowTotal, freeingUpTotal }`.
  `Card` → count strip (`grid grid-cols-5`) → `Separator` → "Free now" and "Freeing up" sublists →
  overflow link to `/allocations`.
- **`upcoming-time-off-panel.tsx`** — `{ rows, total, horizonDays }`. Name, `formatDateRange`,
  `${workingDays}d`, and `PTO_TYPE_LABELS[type]` **only when `type !== null`**.
- **`person-row.tsx`** — `{ id, name, role, lineOfBusiness, trailing? }`. Match the allocations
  planner's person row (`src/components/allocations/allocations-grid.tsx:137-164`): name link to
  `/staff/[id]` + a muted "Engineer · Core" sublabel, **no avatar**. The staffing widget's
  analogue is the staffing grid, not the browse directory — and `getAllocationsGrid` returns no
  `imageUrl`, so avatars would mean widening a shared read for decoration.

### The allocation timeline — DOM, not SVG

`docs/ui.md`'s Charts section already made this call: the no-library rule "has held for structural
diagrams too, **and not by drawing SVG**" — the `/staff` org chart is an indented DOM tree, and
ADR 0054 records rejecting SVG for it. A gantt is a structural diagram, not a plot. Three more
reasons: the row is 70% text and the project name must be a link; SVG can't measure text (see the
`LABEL_CHAR_WIDTH = 6.8` hack and its 12-line apology in `compensation-scatter.tsx:20-29`); and
the nearest sibling — the allocations planner — is already hand-rolled DOM, so matching it makes
the two surfaces read as one system.

Geometry: percent-positioned absolute bars in a relative track, with the two dynamic values passed
as **CSS custom properties**, not inline `left`/`width` — the vendored precedent is
`src/components/ui/toggle-group.tsx:42` setting `--gap` and `card.tsx` consuming
`px-(--card-spacing)`.

```tsx
style={{ "--bar-left": `${leftPct}%`, "--bar-width": `${widthPct}%` } as React.CSSProperties}
className="absolute inset-y-0 left-(--bar-left) w-(--bar-width) rounded-sm …"
```

- **Status colors reuse the planner's exact language** (`allocations-grid.tsx:234-238`) so the two
  surfaces don't invent two dialects: confirmed `border border-primary/40 bg-primary/25`;
  tentative `border border-dashed border-primary/50 bg-primary/[0.06]`. A dashed hairline is
  unreadable at bar height, so **also** put a `<Badge variant="secondary">Tentative</Badge>` next
  to the role label. The badge is self-labeling — skip a legend entirely.
- **Clipping**: a role extending past the window clamps the bar and drops that side's rounding
  (`rounded-l-none` / `rounded-r-none`), but the date cell always shows the **real** dates
  (`→ Sep 12` when it started before the window), and the bar carries a native `title` with the
  full span. Clipping is purely visual.
- **Today marker**: a 1px `bg-foreground/30` rule at `pctOf(today)`, drawn once per row with
  `absolute -inset-y-1 w-px` so consecutive segments touch across a `gap-y-2` and read as one
  line. Cross-row positioning would need the parent to know the track column's geometry, which a
  CSS grid won't tell it — note this compromise in the docblock. Monochrome on purpose; indigo is
  spent on the bars.
- **Mobile**: `hidden sm:block` on the track and axis cells. A four-month bar at 320px is
  decorative noise; the row collapses to `project / role · 100% / Aug 18 → Nov 30`, which carries
  everything.

### Page — `src/app/(app)/page.tsx` (rewritten)

Delete the `STATS` array, the inline card markup, and the "Getting started" card.

```tsx
export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <HomeHeading />          {/* async: getCurrentStaffIdentity() */}
      <YourWorkSection />      {/* async: own reads */}
      <OrganizationSection />  {/* async: getAllocationsGrid + getOrgUtilization */}
    </div>
  );
}
```

- **`max-w-5xl`, `text-2xl`, plain `<div>` (no `<header>`)** — `max-w-5xl` is the house default
  (`max-w-6xl` on the home page is the outlier), and `text-2xl` without a `<header>` matches the
  three `/dashboards/*` pages, which is what this is a sibling of. Leave `(app)/loading.tsx` at
  `max-w-6xl`; it's shared by every route and deliberately shape-agnostic.
- Source `firstName` from **`getCurrentStaffIdentity()`** (`React.cache`d, and it resolves the
  `staffId` the personal reads need anyway) rather than `getCurrentUser()`, which is *not* cached
  (`src/lib/auth/auth.ts:43`) and would be a redundant session round-trip.
- **Sibling async section components, no `<Suspense>`.** `grep -rn Suspense src/` returns zero
  hits repo-wide, and `(app)/loading.tsx` already gives a route-level skeleton. Decomposition
  still buys the real win: the two sections' reads run concurrently without a manual top-level
  `Promise.all`. Pre-specified follow-up if the org read measures slow: wrap **only**
  `<OrganizationSection />` in `<Suspense fallback={<OrgSectionSkeleton />}>` — the personal reads
  are all `staffId`-indexed and cheap, so "Your work" can paint first.

### Layout

```
Welcome back, Andrew                                              h2, text-2xl
Where your work stands, and how the org is tracking this week.

Your work ─────────────────────────────────────────────────────── h3 + border-b

┌───────────────┐┌───────────────┐┌───────────────┐┌───────────────┐ grid gap-4
│ ACTIVE PROJ.  ││ PTO TAKEN     ││ UTILIZATION   ││ PLANNED       │ sm:grid-cols-2
│ 2             ││ 11 days       ││ 80.0%         ││ 100%          │ lg:grid-cols-4
│ Acme · Beta   ││ +4 booked     ││ Week of Jul 27││ Confirmed only│
└───────────────┘└───────────────┘└───────────────┘└───────────────┘

┌───────────────────────────────────────────────────────────────┐  Card
│ Your allocations                          Open the planner →  │
│ ───────────────────────────────────────────────────────────── │
│ Acme Rebuild     Engineer  100%  ▓▓▓▓▓▓┊░░░░   → Sep 12       │  ┊ = today
│ Internal Tooling Architect  50%  ░░▒▓▓▓┊▓▓▓▓   Aug 18 → Nov 30│
│ Beta Platform    Engineer   25%  ░░░░░░┊▓▓▓▓▓  Sep 01 → Dec 19│
│                                  Jul Aug Sep Oct              │  axis, same track
│ 2 more roles · Open the planner →                             │
└───────────────────────────────────────────────────────────────┘

The organization ──────────────────────────────────────────────── h3 + border-b

┌───────────────────────────────────────────────────────────────┐  Card
│ Utilization                                  Week of Jul 27   │
│ ───────────────────────────────────────────────────────────── │
│                    Actual   Planned   Target   People         │
│ Full time           74.8%     82.1%      80%       38         │
│ Hourly              52.3%     61.0%      60%        9         │
│ ───────────────────────────────────────────────────────────── │
│ Overall             71.2%     78.6%      77%       47         │
│ 29 of 47 billable staff have logged time this week            │
└───────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────┐┌───────────────────────┐ lg:grid-cols-[3fr_2fr]
│ Availability            Planner →      ││ Upcoming time off     │
│  Now   +1 wk  +2 wk  +3 wk  +4 wk      ││ Ana Ruiz              │
│   3      5      6      8      9        ││ Aug 12 – Aug 16 · 5d  │
│  3.4 FTE free next week                ││ Ben Osei              │
│ ────────────────────────────────────── ││ Aug 18 – Aug 22 · 5d  │
│ Free now                               ││                       │
│   Ana Ruiz          Engineer · Core    ││ 3 more in 30 days     │
│ Freeing up                             ││                       │
│   Dan Cho   Engineer · Fintech   Aug 18││                       │
│   4 more · Open the planner →          ││                       │
└────────────────────────────────────────┘└───────────────────────┘
```

The personal row is four `StatCard`s (`grid gap-4 sm:grid-cols-2 lg:grid-cols-4`) — the same
four-tile rhythm the placeholder already had, now with real numbers. Org utilization is **a table,
not tiles**: twelve numbers across cohort × actual/planned/target/headcount would be unreadable as
twelve tiles, and a table makes the plan-vs-actual gap legible by putting the two columns
adjacent. Use the `Table` primitives with `ROOMY_TABLE` from `src/components/table-density.ts`,
`tabular-nums` on figures, and a `border-t` before the Overall row.

Mobile: everything single-column below `sm`; the utilization table gets an `overflow-x-auto`
wrapper; the org bottom row stacks below `lg` with Availability first (more actionable); the count
strip stays `grid-cols-5` at all sizes (five short numbers fit at 320px).

**No charts.** Nothing here is a distribution over a continuum: a two-bar chart is a table with
extra steps, and the count strip *is* the chart. The two hand-rolled SVGs in
`src/components/performance/` stay the only charts in the app.

---

## Empty states

Convention: `EmptyState` for a list that would otherwise have rows; a bare
`<p className="text-sm text-muted-foreground">` for a number or paragraph-sized sub-block.

| Case | Treatment |
|---|---|
| No linked staff record | Can't normally happen — `(app)/layout.tsx` redirects to `/profile-setup`. But `getCurrentStaffId()` is `string \| null`, so render "Your work" as one `<InlineNotice icon={IconAlertTriangle}>` and still render "The organization". Defense in depth. |
| No active projects | `value="—"`, hint "Not allocated right now" |
| No PTO | `value="0 days"` — **not `—`**; zero is a real answer and `—` reads as "unknown" |
| Nothing logged this week | Actual `formatPercent(null)` → `"—"` (don't hand-roll it), hint "Nothing logged yet this week". **Planned still shows** — it's known regardless, and the pair reads as "you're committed at 100%, log your time" |
| No allocation this week | Planned `"0%"`, hint "No confirmed work this week" |
| No allocations in window | `<EmptyState>` **unbordered** (already inside a `Card`; bordered doubles the edge), keeping the "Open the planner →" exit visible |
| All roles outside window | Same, plus `N roles outside this window · Open the planner →` |
| Empty FT or hourly cohort | Row renders with `—` in every figure cell and `0` people — `0.0%` for an empty cohort is a lie |
| Nobody logged this week | Actual column is all `—`; the planned column and the coverage line still render. Don't blank the card |
| Nobody free now | Bare `<p>Everyone billable is allocated this week.</p>` |
| Nobody frees up in 4 weeks | Bare `<p>No one frees up in the next four weeks.</p>` |
| Both empty | **Keep the count strip** (five zeros are the headline: "we're fully booked") and collapse the sublists into one line |
| No active billable staff (fresh DB) | Replace the whole `CardContent` with `<EmptyState>No active staff yet.</EmptyState>` |
| No upcoming PTO | `<EmptyState>No time off booked in the next 30 days.</EmptyState>` |

---

## Honesty — what this page could quietly get wrong

These need visible disclosure on the card, not a code comment.

1. **A single week is volatile.** One person's holiday moves a small cohort's number several
   points. Label every figure "Week of Jul 27" so nobody reads it as a trend, and never render a
   utilization number without the week beside it.
2. **Thin coverage.** The actual column describes people who logged, not the company — "29 of 47
   billable staff have logged time this week". Early in the week that will be most of them, which
   is exactly why the line is mandatory rather than a nicety.
3. **The two denominators differ in kind** — actual divides by hours recorded, planned by the
   week's calendar capacity net of approved leave. This is downstream of `staff_pto` and
   `time_entries.category = 'PTO'` being unsynced (`docs/domains/timesheets.md` states this
   outright). **Do not** reconcile them; a blended denominator reconciles with neither source.
   Footnote it. Widget 3's "PTO taken" is the HR record — label it as such so the two PTO numbers
   on this page are visibly different things.
4. **No statutory-holiday calendar.** `countWorkingDays` and the weekday helpers count every
   Mon–Fri, so a holiday week shows five days of capacity unless HR loaded it as
   `STATUTORY_HOLIDAY` leave — which deflates *planned* utilization for that week specifically.
   Footnote: "Mon–Fri; public holidays counted only when recorded as leave."
5. **Tentative ≠ committed** — excluded from planned utilization and from the availability
   denominator, badged everywhere it appears.
6. **Non-billable staff are invisible** in three widgets by design. Say "billable staff only
   (47 of 58)" rather than letting the headcount silently not add up against `/staff`.
7. **Over-allocation is not clamped.** `weekPercent` caps each *role* at 100; a person's sum can
   exceed it, and a planned figure above 100% is the single most valuable thing the personal card
   can tell them. Badge it, don't cap it. (Conversely a 10h/day role reads as 100% in the percent
   model, so planned is a floor.)
8. **Drafts are counted, necessarily** — the current week's timesheet is nearly always a draft, and
   `autofillProjectHours` fills a project row to full capacity on add, so a freshly-autofilled
   draft inflates the billable side specifically. Worth a line in the read's docblock.

## Permissions

No matrix change, so `permissions.ts` / `permissions.test.ts` / `docs/domains/permissions.md` stay
untouched. Three things to hold:

- **PTO type stays gated on `pto: ["review"]`.** `getAllocationsGrid` already decides this
  (`getAllocationsGrid.ts:144-152`). Render `PTO_TYPE_LABELS[type]` only when `type !== null`;
  never re-derive it client-side, never widen the read.
- **Org utilization is a new disclosure surface.** There is no `timesheets.view` capability — only
  `timesheets: ["edit"]`. Aggregate cohort utilization discloses no individual's hours, and the
  section is for everyone, so ungated is defensible and consistent with `/allocations`. The read
  must therefore aggregate server-side and **never return per-person hours or ids**.
- **Per-person allocation status** is already public via `/allocations` — no new disclosure.

---

## Build order

1. Hoist `StatCard` → `src/components/stat-card.tsx`; update 4 imports + the docblock. Land first.
2. `src/lib/allocations/weekdays.ts` (mechanical lift) — `allocations-grid.test.ts` must stay green.
3. Pure modules TDD'd, in order: `timesheets/utilization.ts`, `allocations/availability.ts`,
   `home/allocation-timeline.ts`, `staff/pto-year.ts` — each with its `.test.ts`.
4. Reads: `getStaffUtilization`, `getOrgUtilization`, `getMyAllocations`; modify
   `getAllocationsGrid` (`isBillable`, `React.cache`, `Promise.all`).
5. Components: `home-section` → `person-row` → `allocation-timeline` → `utilization-panel` →
   `availability-panel` → `upcoming-time-off-panel`.
6. Rewrite `src/app/(app)/page.tsx`.
7. Dispatch the **librarian** subagent: `docs/ui.md` (its pages list still calls `/` "placeholder
   stat cards", and the `StatCard` path moved), `docs/architecture.md:91`,
   `docs/domains/performance.md:432`, plus a new ADR recording the current-week utilization
   definition (and why plan and actual have different denominators), the DOM-not-SVG gantt call
   (a second application of ADR 0054), and the org-utilization disclosure.

## Verification

- `bun run check` — Biome + `tsc --noEmit` + `bun test`. The four new test files carry the edge
  cases; `allocations-grid.test.ts` passing unchanged proves the weekday lift was mechanical.
- `bun run build` — non-trivial change, so type-check the production build.
- `bun run dev` and load `/` signed in. Against the real DB (assume it's migrated): the personal
  actual matches this week's hours in `/timesheets`; PTO taken matches the profile PTO section;
  the availability counts reconcile with `/allocations` at week granularity (same `weekPercent`,
  so they must); the bench list matches the people the planner sorts to the top.
- **Spot-check one person's planned figure by hand** against their current-week row in the
  allocations planner — plan-vs-actual is the number most likely to be subtly wrong and it has no
  other surface to cross-check against. A person the planner shows at 100% must read 100% planned.
- **Mid-week partial log**: confirm someone who logged only Monday–Tuesday shows a sane actual
  (share of what they logged), not a deflated one.
- **Permission check by hand:** sign in as a `user`-role account and confirm upcoming time off
  shows name + dates but **no** leave type; as a `manager`, confirm the type appears. Then run
  `/audit-rbac`.
- Degenerate cases: nothing logged yet this week (actual `—`, planned still shown), a person with
  no allocations (empty timeline, planner link still present), and narrow the viewport below `sm`
  to confirm the timeline track hides and rows stay readable.
- `/code-review` before merging.
