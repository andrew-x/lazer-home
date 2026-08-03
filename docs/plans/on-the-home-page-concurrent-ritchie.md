# Home dashboard: "Your Status" and "Lazer Status"

## Context

The home dashboard today is a **year-to-date, timesheet-driven** snapshot with six widgets. Three problems drove this rework:

1. **The personal section says the same thing twice.** An "Active projects" stat tile lists project names as a hint string, and the "Your allocations" gantt draws those same projects as bars. Neither answers the actual question — *what am I on, from when to when, at how many hours a day.* A gantt shows shape, not figures.
2. **Org utilization answers the wrong question.** It reports billable-share-of-logged-hours over Jan 1 → today, from submitted timesheets, against a `utilizationTarget`. But the question people open a dashboard to ask is *right now, how much of the bench is working?* — which is a **staffing-plan** question, not a timesheet question. Timesheet coverage is thin by design (seed: ~15 of 42 people, 4 weeks), so the current figure is mostly a coverage artefact.
3. **The org section can't be interrogated.** Availability is a fixed 5-column strip you can only read, never filter; there's no way to ask "who in Fintech is freeing up in three weeks", and nothing surfaces roles about to start/end or people lent across lines of business.

The outcome: rename the two sections **Your Status** and **Lazer Status**; make Your Status a single factual table; and rebuild Lazer Status as a **point-in-time, allocation-plan-driven** view with a line-of-business filter over five widgets, two of them new.

**No schema change.** Every field needed already exists.

## Decisions taken (from clarification)

| Question | Decision |
|---|---|
| Your Status shape | **Table only** — delete the "Active projects" tile *and* the gantt |
| Upcoming roles | **Include open/unfilled roles** — they're the most actionable rows |
| "By role" breakdown | **`staff_employment.role`** (person's discipline, 9 values) — it has a population denominator |
| LOB filter meaning | **The person's home LOB** — filters the population of people, uniformly across every widget |
| The two time bases | **Deliberate and permanent:** Your Status is **year to date**, Lazer Status is **point in time**. Not a wart to reconcile later — see below |

### The two time bases are the design, not a compromise

The page carries **two different time bases on purpose**, and this must be preserved rather than "fixed":

- **Your Status — year to date.** A person's own utilization is a cumulative fact about their year: *how has my time actually gone so far?* It is measured from submitted timesheets over 1 Jan → today. A point-in-time personal figure would be noise — today's number swings on a single day's logging.
- **Lazer Status — point in time.** The organization's question is *right now, how much of the bench is working?* It is measured from **allocation plans** as of today. A YTD org figure buries exactly the thing a staffing lead needs, and inherits thin timesheet coverage as if it were low utilization.

So the two sections deliberately draw on **different sources** (timesheets vs. the staffing plan) over **different windows** (cumulative vs. instantaneous). Because both would otherwise be called "utilization", labelling is a **requirement, not polish**:

- Your Status tiles must name the window — "Billable share of hours logged · YTD".
- Lazer Status must name the instant — "Staffed today", header "As of {today}", never the bare word "Utilization" alone.

Record this in the new ADR as the reason the two coexist, so a future reader doesn't unify them and destroy both answers.

## Key facts established during exploration

- **`project_roles` *is* the allocation entity** — there is no `allocations` table. `hoursPerDay` is `numeric(4,2)`; percent is always derived as `hoursPerDay / 8`.
- **`lineOfBusiness` exists on both sides** — `staff_employment.lineOfBusiness` (home LOB) and `project_roles.lineOfBusiness` (the work's LOB). Both `NOT NULL`. This is what makes "borrowed staff" computable with no schema change.
- **`getAllocationsGrid()`** (`src/actions/allocations/getAllocationsGrid.ts`) already returns everything the whole Lazer Status section needs — staff (with home LOB, `role`, `employmentType`, `isBillable`), roles (with `projectId`, `projectName`, role LOB, `status`, dates, `hoursPerDay`), and approved time off. It is `React.cache`d and shared with `/allocations`, so reusing it costs one query set per request.
- Its role query **joins only `projects`, not staff** (`getAllocationsGrid.ts:149-155`), so dropping `isNotNull(projectRoles.staffId)` from the WHERE is safe — the existing `r.staffId !== null` filter at line 208 keeps `roles` byte-identical, and a second projection over the same rows yields open roles with **no extra round trip**.
- **`getMyAllocations()` bounds roles to the gantt's window** (−1 month → +2 months) via `timelineWindow`. A role starting in four months is invisible today. Widening this is what makes the whole `allocation-timeline` module deletable.
- **The filter pattern is already established**: on `/dashboards/utilization`, the date range lives in the URL (it bounds the query) while the LOB filter and forecast toggle are **in-memory client state**, because neither changes what is fetched (`src/components/utilization/utilization-filters.tsx:19-23`). Lazer Status has no range, so *all* of its controls are client state and no URL params are added.
- Reusable primitives: `SegmentedFilter` / `SelectFilter` / `ALL` (`src/components/form/filters.tsx`), `Tabs` (`src/components/ui/tabs.tsx`), `PersonRow`, `StatCard`, `EmptyState`, `formatDateRange` / `formatPercent` / `formatShortDate`, `LINE_OF_BUSINESS_LABELS`, `ROLE_LABELS`, `EMPLOYMENT_TYPE_LABELS`, `countWorkingDays`, and the weekday primitives in `src/lib/allocations/weekdays.ts`.

## ⚠️ Disclosure constraint — read before writing the client component

`AllocationStaffRow` carries **`allocationNotes`**, manager-only staffing commentary gated on `staff.edit` inside the read (`getAllocationsGrid.ts:180-183`). Making Lazer Status a Client Component means its props are **serialized into the page HTML for every viewer.**

**Never pass `grid.staff` (or `grid` itself) into the client component.** Project explicitly into a purpose-built payload type that omits `allocationNotes` and `canEditNotes`. This is the one way this change could introduce a real vulnerability, so the payload builder must whitelist fields, never spread.

Time-off `type` is already nulled upstream for viewers lacking `pto.review` — pass it straight through and **never re-derive it** (existing rule, `upcoming-time-off-panel.tsx:11-19`).

No new permission gates are needed: everything shown is already public via `/allocations` to any signed-in user. The section stays open, and `docs/domains/permissions.md` needs no change.

---

## Part 1 — Your Status

### Metric definitions

- **Staffed** = holds ≥1 **confirmed** role whose span contains today. Tentative does not commit (the codebase-wide rule behind `latestConfirmedEnd` and `currentLoadPercent`).
- Someone on PTO today **still counts as staffed** — staffing is about allocation, not attendance. Say so in the docblock.

### Changes

**`src/actions/allocations/getMyAllocations.ts`** — replace the timeline-window bounds with `gte(projectRoles.endDate, today)`: live-or-upcoming roles, no upper bound. Drop the `timelineWindow` import and the now-stale docblock paragraph about the display window.

**New `src/components/home/my-allocations-table.tsx`** (Server Component) — one table replacing both the tile and the gantt:

| Project | Client | Dates | Hours/day |
|---|---|---|---|

- Project name links to `/projects/{id}`. **No planner link anywhere in this section.**
- A `tentative` badge on tentative rows (reuse `PROJECT_ROLE_STATUS_VARIANTS`).
- Group/sort: live-today roles first (by descending `hoursPerDay`), then upcoming by `startDate`; a subtle "Upcoming" divider row between the two.
- Delivery-manager-only projects appear with an em dash for hours and a "Delivery lead" badge — carrying no hours, they must not fabricate one (the existing `activeProjects` rule).
- `EmptyState` when there is nothing: "You're not allocated to anything right now."

**`src/app/(app)/page.tsx`** — rename the section to **"Your Status"**. Keep the "PTO taken", "Utilization" and "Planned" tiles (unchanged, still timesheet-YTD); drop "Active projects"; render the new table below them.

> **Keep Your Status year-to-date.** The "Utilization" and "Planned" tiles stay exactly as they are — timesheet-driven, 1 Jan → today, via `getStaffUtilization`. This is the intended contrast with Lazer Status's point-in-time figures (see *The two time bases* above), so do **not** convert them to plan-based or point-in-time. The only required change here is making the window explicit in the tile hints.

### Deletions

Once the gantt is gone, `timelineWindow` has no caller, so the whole module goes:

- `src/components/home/allocation-timeline.tsx`
- `src/lib/home/allocation-timeline.ts` + `allocation-timeline.test.ts`
- `src/lib/home/my-work.ts` → `activeProjects` and `nextStartDate` lose their callers; **keep `currentLoadPercent`** (still used by the "Planned" tile hint). Trim the module and its test to match rather than deleting it.
- `MyAllocationRole` currently aliases `TimelineRoleInput`; inline the field list into `getMyAllocations.ts` so nothing imports the deleted module.

Verify with `grep -rn "allocation-timeline\|activeProjects\|nextStartDate" src/` before deleting — nothing outside the home page referenced them at exploration time.

---

## Part 2 — Lazer Status

### Architecture

One server read → one pure fold → one client component that owns all filter state.

```
page.tsx (server)
  getAllocationsGrid()                    ← existing, React.cache'd, + new openRoles
  buildOrgStatus(...)                     ← new pure fold, whitelisted payload
    └─> <LazerStatusSection payload={…}/> ← "use client", owns LOB + week + employment state
          ├─ StaffingPanel        (recomputed client-side per filter)
          ├─ AvailabilityPanel    (week tabs + employment filter)
          ├─ UpcomingTimeOffPanel (now with project subtitle)
          ├─ UpcomingRolesPanel   (new)
          └─ BorrowedStaffPanel   (new)
```

All filtering is client-side over an already-fetched payload — no refetch, no URL params, matching the `/dashboards/utilization` precedent. The payload is per-person and per-role records rather than pre-aggregated totals, precisely so the client can re-derive every figure after filtering.

### `src/actions/allocations/getAllocationsGrid.ts`

Additive only. Remove `isNotNull(projectRoles.staffId)` from the role query's WHERE, keep the existing `staffId !== null` filter that builds `roles`, and add a parallel projection:

```ts
export type OpenRoleRow = Omit<AllocationRoleRow, "staffId">;   // staffId is null by definition
// AllocationsGridData gains: openRoles: OpenRoleRow[]
```

Update the "Staffed roles only" comment at lines 132-134 — it becomes wrong. `/allocations` ignores the new field and is unaffected.

### `src/lib/allocations/availability.ts`

Two surgical changes:

1. **Extract the week aggregation.** Lines 209-221 compute `AvailabilityWeek[]` from `people` inline. Pull that into an exported `summarizeWeeks(people, weekStarts): AvailabilityWeek[]` and have `buildAvailability` call it. The client re-runs the *same function* after filtering, so a filtered count can't drift from an unfiltered one.
2. **`buildUpcomingTimeOff` gains a `roles` parameter** so each leave row can name the project(s) the person is on. Attribution: roles overlapping the leave span, confirmed preferred over tentative, heaviest `hoursPerDay` first. Return `projects: { projectId, projectName }[]`; the panel renders the first with `truncate` plus `+N` when there are more.

Update `availability.test.ts` for both signatures.

### New `src/lib/home/org-status.ts` (+ `org-status.test.ts`)

Pure, client-importable (no `db`, no React) — the pattern every other `src/lib/home` and `src/lib/allocations` module follows.

**`buildOrgStatus(staff, roles, openRoles, timeOff, today, weekStart)`** → the whitelisted payload:

```ts
type OrgPerson = {
  staffId; name; role: Role | null;
  lineOfBusiness: LineOfBusiness | null;      // home LOB — what the filter matches
  employmentType: EmploymentType | null;
  weeks: WeekLoad[];                          // from buildAvailability
  freeFrom: string | null; tentativeOnly: boolean;
  staffedToday: boolean;                      // ≥1 confirmed role live today
};
type OrgUpcomingRole = {
  roleId; projectId; projectName; roleType; roleLineOfBusiness;
  staffId: string | null; staffName: string | null;
  personLineOfBusiness: LineOfBusiness | null; // null for open roles
  startDate; endDate; kind: "starting" | "ending"; inDays: number;
};
type OrgBorrowed = {
  staffId; name; homeLineOfBusiness; projectId; projectName;
  roleLineOfBusiness; roleType; endDate;
};
type OrgLeave = UpcomingLeave & {
  projects: { projectId; projectName }[];
  personLineOfBusiness: LineOfBusiness | null;
};
```

Population is `isBillable === true`, identical to `buildAvailability` — one definition of "the bench".

**`summarizeStaffing(people): StaffingSummary`** — the point-in-time replacement for the YTD table:

```
staffed          = people.filter(p => p.staffedToday).length
headcount        = people.length
fullTimeCount    = people.filter(p => p.employmentType === "FULL_TIME").length
rate             = headcount > 0 ? staffed / headcount : null
normalizedRate   = fullTimeCount > 0 ? staffed / fullTimeCount : null
byRole           = same four figures grouped by person's `role`
```

- **No `utilizationTarget` anywhere** — the target column is gone by request.
- `normalizedRate` is **deliberately uncapped**: staffed hourly people over a full-time denominator can exceed 100%, and that is the FTE-normalization signal, not a bug. Guard `fullTimeCount === 0` → `null`, never `0`.
- Rates are `number | null` (never `0` for "unknown"), following the `Rate`/`HoursSeries` convention already used in `src/lib/timesheets/utilization.ts` and `src/lib/utilization/utilization-report.ts`.
- **No small-cohort suppression** (unlike `MIN_COHORT_SIZE = 3` in the YTD module). These are *headcounts*, not individual hours, and `/allocations` and the availability panel already name the same people. Document this as a deliberate departure so a future reader doesn't "restore" it.

**`filterByLineOfBusiness(payload, lob)`** — matches the **person's home LOB** on all five widgets. For `OrgUpcomingRole`, open roles have no person, so they match on the **role's** LOB (otherwise unfilled roles would vanish under every filter — the exact rows the user asked to see).

### Components

**New `src/components/home/lazer-status-section.tsx`** (`"use client"` — the first client component in `src/components/home/`). Owns three pieces of state: `lineOfBusiness` (default `ALL`), `weekIndex` (default 0), `employmentType` (default `ALL`). Renders the LOB `SelectFilter` in the section header, then the five panels. Note in the docblock that this route previously shipped zero client JS (`docs/plans/on-the-home-page-stateless-diffie.md:307-310` argued against a selector) and that the explicit request for tabs and filters supersedes it.

**`utilization-panel.tsx` → new `src/components/home/staffing-panel.tsx`** — rewritten, not edited. Header stat row: **Staffed** · **Headcount** · **Staffed rate** · **Normalized rate** (with a hint spelling out "staffed ÷ full-time headcount"). Then the by-role table:

| Role | Staffed | Headcount | Rate |
|---|---|---|---|

with an emphasized Overall row (reuse the existing `emphasize` row treatment). Empty roles render "—", never a fabricated `0.0%` — the existing rule at `utilization-panel.tsx:120-129`. Replace the YTD date range in the header with "As of {today}", since the metric is now point-in-time.

**`availability-panel.tsx`** — becomes a client component driven by the parent's state:
- The 5-column count strip becomes **`Tabs`**: "Now", "+1 wk", "+2 wk", "+3 wk", "+4 wk". Each tab shows that week's available count and free FTE, and the name list below is scoped to **that week's** free people (`weeks[i].freePercent >= AVAILABLE_THRESHOLD_PERCENT`) — not the current `freeFrom`-keyed split, which is what lets someone "flip through and see who is freeing up on those weeks".
- A **`SegmentedFilter`** for All / Full time / Hourly.
- Counts and FTE recompute from `summarizeWeeks(filteredPeople, weekStarts)` — never from the server's unfiltered numbers.
- Keep the Mon–Fri / no-holiday-calendar footnote; it is still true.
- Raise `NAME_LIMIT` from 4 (a per-week list is shorter than the old cumulative one) and keep the "+N more" line. Per the request, the planner links come out of Your Status; the availability "open the planner" link is the natural way to see the rest, so **keep it here** — flag it, and it's a one-line removal if you'd rather it go too.

**`upcoming-time-off-panel.tsx`** — add the project subtitle under each name: project name linking to `/projects/{id}`, `truncate` with `min-w-0` so long names ellipsize, `+N` when someone is on several, and nothing at all when they're on none (no "—" noise). `PersonRow` may need a `subtitle` slot; it currently takes only `trailing`.

**New `src/components/home/upcoming-roles-panel.tsx`** — roles starting or ending within 28 days, two lists in one card ("Starting" / "Ending"), soonest first, with relative "in 9d". Open roles show the role type and an **`Unfilled`** badge in place of a person. Define the horizon as an exported `UPCOMING_ROLES_HORIZON_DAYS = 28` alongside the existing `UPCOMING_TIME_OFF_HORIZON_DAYS`.

**New `src/components/home/borrowed-staff-panel.tsx`** — people on a role today whose `roleLineOfBusiness !== homeLineOfBusiness`. Row: person (with home LOB) → project (linked, with the role's LOB), plus the role end date. Skip anyone whose home LOB is null — unknown is not "borrowed".

> Related surface worth knowing: `/dashboards/utilization` already has `buildLobAlignment` (`src/lib/utilization/utilization-report.ts`), a day-weighted *aggregate* of the same cross-LOB idea. This panel is the point-in-time, **named-people** view. Different enough to justify both; reference each from the other's docblock so nobody merges them by accident.

### Deletions

`getOrgUtilization` was home's only consumer, so it and its YTD-cohort machinery become dead:

- `src/actions/timesheets/getOrgUtilization.ts`
- From `src/lib/timesheets/utilization.ts`: `splitByEmploymentType`, `weightedTargetOf`, `groupOf`, `withheld`, `UtilizationGroup`, `UtilizationRecord`, `MIN_COHORT_SIZE` — plus their blocks in `utilization.test.ts`.
- **Keep** `computeUtilization`, `buildPlanRow`, `allocatedHoursInRange`, `HoursRow`, `PlanRow`, `Rate` — still used by the personal tiles via `getStaffUtilization`, and by `/dashboards/utilization`.

Confirm with `grep -rn "getOrgUtilization\|splitByEmploymentType\|MIN_COHORT_SIZE\|UtilizationGroup" src/` first. Also prune the docblock paragraph in `utilization.ts` that describes the cohort/suppression model.

---

## Part 3 — Seed data caveat

`scripts/seed/staff.ts:90` hardcodes `employmentType: "FULL_TIME"` for **all 42 staff**. Consequences on seed data:

- The **Hourly** availability filter is always empty.
- **`normalizedRate` is identically equal to `rate`**, so the headline new metric is indistinguishable from the plain one and the divide-by-zero and >100% paths are never exercised.

Two things follow, and the first is not optional:

1. **Unit-test `summarizeStaffing` with mixed employment types** — including `fullTimeCount === 0` → `null` and a staffed-hourly case pushing `normalizedRate` above 100%. Tests, not seed, are the correctness guarantee.
2. **Recommended:** make ~15% of seeded ICs `HOURLY` so the filter and the normalized rate are visibly exercised in dev. This is a seed-realism fix, not a data-model change — `HOURLY` is already a valid enum value reachable via the Rippling CSV import (`deriveEmploymentType`). Small, contained, and it makes the feature demonstrable.

---

## Files at a glance

**Modify:** `src/app/(app)/page.tsx` (substantial rewrite) · `src/actions/allocations/getAllocationsGrid.ts` (+`openRoles`) · `src/actions/allocations/getMyAllocations.ts` (widen bounds) · `src/lib/allocations/availability.ts` (+`summarizeWeeks`, `buildUpcomingTimeOff` roles) · `src/components/home/availability-panel.tsx` (client, tabs, filter) · `src/components/home/upcoming-time-off-panel.tsx` (project subtitle) · `src/components/home/person-row.tsx` (+`subtitle` slot) · `src/lib/timesheets/utilization.ts` (prune) · `src/lib/home/my-work.ts` (trim) · `scripts/seed/staff.ts` (optional)

**New:** `src/lib/home/org-status.ts` + test · `src/components/home/lazer-status-section.tsx` · `src/components/home/staffing-panel.tsx` · `src/components/home/upcoming-roles-panel.tsx` · `src/components/home/borrowed-staff-panel.tsx` · `src/components/home/my-allocations-table.tsx`

**Delete:** `src/components/home/allocation-timeline.tsx` · `src/lib/home/allocation-timeline.ts` + test · `src/components/home/utilization-panel.tsx` (replaced) · `src/actions/timesheets/getOrgUtilization.ts`

## Build order

1. `getAllocationsGrid` + `openRoles`; `getMyAllocations` bounds. Confirm `/allocations` still renders.
2. `src/lib/home/org-status.ts` + tests, and the `availability.ts` extraction + test updates. **Pure layer green before any UI.**
3. Your Status: the table, then delete the gantt and its lib.
4. Lazer Status: the client section shell + `StaffingPanel`, then the availability tabs/filter, then the three remaining panels.
5. Delete `getOrgUtilization` and prune `utilization.ts`.
6. Optional seed change.
7. Rename both section headings and the page's intro copy. The intro must set up the two time bases — something like "Your year so far, and where the org stands today" — and each section's `description` should carry its own window ("Your work this year" / "The whole org, as of today"). Update the `page.tsx` top docblock too: it currently claims the dashboard is a point-in-time snapshot throughout, which becomes half true.

## Verification

1. **`bun run check`** — Biome + `tsc --noEmit` + `bun test`. Must be green; the pure-layer tests are the real proof and the seed imports real Drizzle tables, so a stale seed shows up here.
2. **`bun run build`** — this is non-trivial and adds the route's first client component; confirm no server-only import (`db`/drizzle) is pulled into the client bundle by `org-status.ts`. That failure mode is a build error, so the build is the check.
3. **`bun run dev`, load `/`** and verify by hand:
   - Your Status shows one table with real dates and hours, and **no planner link**.
   - **The two time bases read unambiguously side by side:** every Your Status figure is labelled year-to-date, every Lazer Status figure "as of today". Nothing on the page says a bare "Utilization" without its window attached.
   - LOB filter → every Lazer Status figure moves together; `ALL` restores.
   - Availability tabs → flipping Now…+4wk changes both the count and the named list; Full time / Hourly / All re-filters.
   - Time-off rows show a linked project and ellipsize a long name.
   - Upcoming roles shows both starting and ending inside 28 days, with `Unfilled` rows present.
   - Borrowed staff rows genuinely differ in home vs role LOB (cross-check one person against `/allocations`).
4. **Disclosure check — do this explicitly.** As a non-manager user (no `staff.edit`), open `/`, View Source, and search the HTML for a known `allocationNotes` string from the seed. **It must not appear.** Same for a PTO `type` label without `pto.review`. This is the one regression this change could plausibly introduce.
5. **Arithmetic spot-check:** pick one line of business, count in `/allocations` who holds a confirmed role spanning today, and confirm it equals the panel's Staffed figure for that filter.
6. **Dispatch the `librarian` subagent** afterwards — this touches the home dashboard, deletes a read, and changes what utilization *means* on that surface. It should reconcile `docs/domains/allocations.md`, `docs/domains/timesheets.md`, `docs/domains/utilization.md` and `docs/ui.md`, and record a new ADR for the point-in-time-plan-based staffing metric superseding home's YTD timesheet table (relating it to ADR 0062, which stays valid for `/dashboards/utilization`).
