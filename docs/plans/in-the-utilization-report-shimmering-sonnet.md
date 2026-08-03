# Reshape the utilization report

## Context

`/dashboards/utilization` shipped (ADR 0062) as a **two-series** report: every hours-bearing
number carries a *planned* figure (from `project_roles`) and a *confirmed* figure (from
submitted timesheets) side by side, never summed. In practice that doubles every column, and
the extra dimensions on top — a tentative-roles forecast toggle, an internal-admin row, a
cohort-level line-of-business table — make the page wide and hard to read without answering
the questions people actually bring to it.

This reshapes the report around four changes:

1. **One basis at a time.** A single **Planned / Logged** toggle at the top replaces the
   doubled columns. Planned is the default. In Logged mode, a figure that deviates
   significantly from plan is flagged — that's where the two-series comparison earns its
   keep, instead of being paid for on every row.
2. **Fewer dimensions.** Tentative roles stop being a factor (confirmed roles only), internal
   admin is dropped, and PTO becomes a full-time-only measure. Filters reduce to **date range
   + line of business**, with month/quarter/year shortcuts.
3. **Part-time is measured, not just excluded.** Project hours, PTO and bench are full-time
   figures; part-time (`HOURLY`) project hours get their own figure and a share of total
   project hours.
4. **The two tables become usable at scale.** Staff breakdown and line-of-business alignment
   both get search + type/role filters + pagination; LOB alignment becomes per-person.

The math module already computes both series, so the toggle is mostly a presentation collapse
— and the deviation warning needs both series anyway.

## Decisions taken

| Question | Decision |
|---|---|
| Section order | Headcount → Roles → Bench → PTO → **Utilization** → Staff breakdown → LOB alignment |
| Planned vs logged | One global basis toggle, default **Planned**; Logged mode flags deviation |
| Date shortcuts | **Period-to-date** — this month/quarter/year end *today*; last month is a full month |
| Staff-breakdown PTO/bench columns | Follow the basis (so Planned by default) |
| LOB alignment basis | Follows the same global toggle |
| "Part time" | The enum is `FULL_TIME | HOURLY` — there is no `PART_TIME`. `HOURLY` is the stand-in; enum cells keep the `EMPLOYMENT_TYPE_LABELS` wording ("Hourly"), prose says "part-time (hourly)". No migration. |

### The Logged toggle is gated cohort-wide

Reading another person's logged hours requires `timesheets.edit` (ADR 0062 §3). Today a
restricted viewer gets their *own* confirmed figures inline and "restricted" everywhere else.
With a single-basis toggle that produces a report that is almost entirely blank, so instead:

- **The Logged segment is disabled** for viewers without `timesheets.edit`, with a tooltip
  ("Requires timesheet access"). They see the full Planned report.
- The read **skips both timesheet queries entirely** for them — narrower than today, which
  fetched their own rows. `confirmedStaffIds: string[] | null` collapses to a single
  `canViewLogged: boolean`.
- Consequence: `hasConfirmedAccess` per row and the `canSeeConfirmed` predicate disappear;
  gating is cohort-level. Every "restricted" cell disappears with them. The `null`-never-`0`
  discipline for withheld figures stays.

This only ever tightens disclosure. **No permissions-matrix change** — `docs/domains/permissions.md`
and `src/lib/auth/permissions.test.ts` are untouched.

## Files

### Math — `src/lib/utilization/utilization-report.ts`

Keep `HoursSeries { planned, confirmed, variance }` and the `null`-not-`0` rule: the basis
toggle chooses what renders, it does not change what's computed.

- **Remove tentative:** delete `TENTATIVE_WEIGHT`, drop `status` from `UtilizationRole`, drop
  `includeTentative` from `UtilizationInputs`, and drop the `!includeTentative` branch in
  `buildRoleSummary` and the confirmed-role filters in the ledger / `buildLobAlignment`.
- Drop the unused `projectName` from `UtilizationRole` (nothing in this module reads it).
- **Add the deviation contract:** `DEVIATION_THRESHOLD = 0.2`, `DEVIATION_FLOOR_HOURS = 8`
  (one working day, so small numbers don't trip it), plus
  `hoursDeviation(series): number | null` (relative delta; `null` when `confirmed` is null or
  `planned` is under the floor) and `deviates(series): boolean`.
- **`StaffLedger`:** replace `lobDays: Map<LineOfBusiness, number>` with
  `lobPlannedHours: Map<LineOfBusiness, number>` — the plan side now speaks hours on both
  sides so a per-person share is comparable. Attribution per day (see the rule below).
- **`EntryTotals`:** drop `internalAdmin`; the `INTERNAL_ADMIN` case in `addEntry` becomes an
  explicit ignore with a comment. Add a per-person `lobLoggedHours` map, folded in the same
  per-person loop in `buildUtilizationReport` (it needs the person's roles + PTO days).
- **`buildPtoSummary`:** cohort narrows to `cohort.filter(isFullTime)` for both the
  `staff_pto`-derived and the logged figures.
- **`buildUtilizationSummary`:** move `confirmedPto` / `confirmedBench` inside the
  `isFullTime` branch (today they wrongly include hourly people's entries); drop the
  `internalAdmin` row from `UtilizationSplitRow["key"]`; add
  `hourlyProjectShare: { planned: number | null; confirmed: number | null }`.
- **`buildStaffBreakdown`:** add `plannedPtoHours` / `confirmedPtoHours`,
  `plannedBenchHours` / `confirmedBenchHours` and their shares of available hours; drop
  `weeksSubmitted`, `weeksInRange`, `hasConfirmedAccess`.
- **`buildLobAlignment` → `buildLobAlignmentRows`:** one row per person —
  `{ staffId, name, role, lineOfBusiness, employmentType, planned: Record<LineOfBusiness, number>, logged: Record<LineOfBusiness, number> | null, plannedTotal, loggedTotal }`
  — sorted by name, plus a cohort total row.

**Line-of-business attribution (one rule, both bases):**

- Project time → the line of business of the **project role** the person held.
- Leave taken **while staffed on a project** → that project's line of business.
- Leave taken while unstaffed, plus unallocated/bench time → the person's **own** line of
  business.
- Internal admin time is **excluded** entirely.
- *Planned* reads role `hoursPerDay` per covering role, `HOURS_PER_DAY` for a PTO day
  (full-time only), and the unstaffed remainder of a full-time day as bench. *Logged* reads
  submitted `time_entries`; hours against a project the person was never staffed to fall back
  to their own line of business, because `projects` carries no line of business — only its
  roles do (ADR 0033).

This replaces the old planned side, which counted **days** with a "top role wins" tiebreak.

### Range presets — `src/lib/utilization/utilization-range.ts`

Add `RANGE_PRESETS = ["thisMonth","lastMonth","thisQuarter","thisYear"]`, a label map,
`presetRange(preset, today = currentDay()): UtilizationRange`, and
`matchingPreset(range, today): RangePreset | null` (so the active preset highlights and a
hand-picked window highlights none). All period-to-date except `lastMonth`:

| Preset | Start | End |
|---|---|---|
| This month | `getMonthStart(today)` | today |
| Last month | `addMonths(getMonthStart(today), -1)` | `addDays(getMonthStart(today), -1)` |
| This quarter | `addMonths(getMonthStart(today), -(monthIndex % 3))` | today |
| This year | `YYYY-01-01` | today |

Build on the existing `getMonthStart` / `addMonths` / `addDays` / `currentDay` in
`@/lib/timesheets/timesheet-week`. Replace `currentMonthRange()` with
`presetRange("thisMonth")` as the default window so the default matches a highlighted preset.
`MAX_RANGE_DAYS = 366` still covers every preset; the ◀ ▶ buttons keep shifting by window
length.

### Read — `src/actions/utilization/getUtilizationReport.ts`

- Roles: `eq(projectRoles.status, ROLE_STATUS.confirmed)` instead of the two-status
  `inArray`; drop the `projects` join and `projectName` with it.
- Timesheets: run the entry + week queries **only** when `canViewAllTimesheets`; delete the
  `viewerStaffId` / `timesheetScope` path and the now-unused `ownStaffId` import.
- Return `canViewLogged: boolean` in place of `confirmedStaffIds`.
- Update the disclosure doc comment to describe the cohort-level gate.

### Filter bar — `src/components/utilization/utilization-filters.tsx`

Three controls: **Basis** (segmented Planned | Logged; Logged disabled without access, with
an `IconButton`-style tooltip), **Line of business** (existing `SelectFilter`), **Period**
(four preset `Button`s — `variant={active ? "default" : "outline"} size="sm"` — above the
existing ◀ `EndpointPicker` – `EndpointPicker` ▶ row). Delete the Forecast `Switch`.

### Shell — `src/components/utilization/utilization-report.tsx`

State: `lineOfBusiness` (existing), plus `basis: "planned" | "logged"` defaulting to
`"planned"`. Both stay client state — neither changes what's fetched; only the window is in
the URL. Render order becomes Headcount → Roles → Bench → PTO → Utilization → Staff
breakdown → LOB alignment, with `basis` threaded to every card.

### Cards — `src/components/utilization/*`

| Card | Change |
|---|---|
| `headcount-card` | "Discipline" → **"Role"** (column head + "All disciplines" → "All roles"). Counts, so basis-independent. |
| `roles-card` | Confirmed roles only. The "Projects" tile shows `uniqueProjects` (planned) or `projectsWithLoggedTime` (logged), with the label following the basis. |
| `bench-card` | Bench-hours tile follows the basis; the separate "Logged bench" tile goes. Streak/day metrics are plan-derived and don't flip — say so in the caption. |
| `pto-card` | Full-time staff only (new). PTO-hours tile follows the basis; record-shape metrics come from `staff_pto` and don't flip. |
| `utilization-card` | 4 stat cards: Available hours · Project hours · Utilization · **Part-time project hours** (hint carries its % of all project hours). Table collapses to `Full-time time | Hours | % available` over Project / PTO / Bench (internal-admin row removed), footer Available / 100%. In logged mode: an `InlineNotice tone="destructive" icon={IconAlertTriangle}` when cohort project hours deviate, quoting logged vs planned, the %, and the coverage caveat. |
| `staff-breakdown-card` | Filters + pagination (below). Columns: `Name` (links `/staff/{id}` via `InternalLink`) · `Line of business` · `Type` · `Role` · `Available` · `Project` · `Project %` · `PTO` · `PTO %` · `Bench` · `Bench %`. Weeks column removed. Hourly rows render "n/a" for Available/PTO/Bench (no fixed capacity; PTO and bench are full-time measures). Logged mode adds a `text-destructive` `IconAlertTriangle` beside a deviating Project cell, tooltipped with logged-vs-planned. |
| `lob-alignment-card` | Per person. Filters + pagination. Columns: `Name` · `Type` · `Role` · `Line of business` · one column per line of business (Corporate, Core, Fintech, Commerce, Design) showing that person's share of attributed hours; the home-LOB cell is `font-medium`, zero renders "—". Footer = cohort shares. The caption spells out the attribution rule above verbatim — it is not self-evident. |

New shared pieces:

- `src/components/utilization/staff-table-filters.tsx` — `useStaffTableFilters()` (search /
  type / role state + a `matches(row)` predicate) and a `StaffTableFilters` control bar,
  instantiated **independently** by each of the two tables. Reuses `FilterLabel`,
  `SelectFilter`, `SegmentedFilter` from `@/components/form/filters` and the search-input
  shape from `src/components/staff/staff-directory.tsx` (`Input type="search"` + `IconSearch`).
- Pagination is **client-side** — the whole projection is already in the client, and routing
  the filters through the URL would refetch six SQL queries per keystroke. Extend
  `src/components/pagination-controls.tsx` with an optional `onPageChange`: when present,
  the page buttons render `onClick` instead of `Link` and `basePath`/`params`/`paramKey`
  become optional, reusing the existing `pageWindow` strip. No `"use client"` directive
  needed — the module compiles into whichever graph imports it, and only the client tree
  passes a function. 20 rows/page; page resets to 1 when filters or basis change.

### Page — `src/app/(app)/dashboards/utilization/page.tsx`

`max-w-6xl` → `max-w-7xl` (the breakdown table is wide — matching the projects list), and
pass `canViewLogged` through to the shell.

### Seed — `scripts/seed/staff.ts`

`makeEmployment()` hardcodes `employmentType: "FULL_TIME"`, so **every seeded person is
full-time** and the part-time share, the "n/a" cells and the Type filter are all unexercised.
Give ~15% of ICs `HOURLY` so the new figures can actually be seen.

### Tests (ADR 0037 carve-out — keep these green)

- `src/lib/utilization/utilization-report.test.ts` — drop the tentative cases; retarget the
  LOB assertions to the per-person hours shape; add: PTO full-time-only, confirmed PTO/bench
  full-time-only, part-time project share, PTO-during-a-project attribution,
  bench → home line of business, internal-admin exclusion, `hoursDeviation`/`deviates`
  around the threshold and the floor, staff-breakdown PTO/bench shares.
- `src/lib/utilization/utilization-range.test.ts` — preset arithmetic (month/quarter/year
  boundaries, period-to-date, last-month as a full month), `matchingPreset` hit and miss, and
  the changed default window.

### Docs

Dispatch the **`librarian`** subagent after implementation to rewrite
`docs/domains/utilization.md` and add an ADR recording what supersedes ADR 0062: single-basis
toggle (§1), tentative roles dropped (§8), LOB alignment per-person and hours-based on both
sides (§7), PTO full-time-only, internal admin dropped, logged mode gated cohort-wide with
the own-row path removed (narrows §3), and the deviation threshold.

## Verification

1. `bun run check` (Biome + `tsc --noEmit` + `bun test`) and `bun run build`.
2. `bun run db:seed`, then `bun run dev` and walk `/dashboards/utilization` signed in as the
   seed admin (`andrew@lazertechnologies.com`):
   - each preset lands on the period-to-date window in the table above and highlights; ◀ ▶
     still steps by window length; a hand-picked window highlights no preset.
   - basis toggle flips every section; **planned mode shows no deviation warnings**; logged
     mode shows the utilization notice and per-row markers, and the numbers move.
   - line-of-business filter narrows the cohort everywhere.
   - both tables: name search, Type and Role filters, pagination past page 1, page resetting
     to 1 when a filter changes; names link to `/staff/{id}`.
   - PTO section and the utilization PTO/bench rows exclude hourly staff; the part-time
     project-hours figure is non-zero and its share is consistent with the Project total.
   - LOB percentages total 100% per person (and in the footer) wherever hours exist.
3. Sign in as a non-manager (any seeded IC): the **Logged** segment is disabled with its
   tooltip, no logged figure appears anywhere, and the planned report is complete.
4. `/code-review` and address findings before merging (per `AGENTS.md`).

## Out of scope

Real per-person capacity (`utilizationTarget`, part-time hours/week, holiday calendar) stays
unmodelled — the denominator remains a flat 8 h × Mon–Fri for full-time staff. Adding a real
`PART_TIME` employment type, exporting the report, and timesheet approval are all untouched.
