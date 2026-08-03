# 0063 — Utilization report v2: one basis at a time with deviation flags, no tentative roles, per-person hours-based LoB attribution, and a cohort-wide logged gate

**Status:** accepted · 2026-08-03 · **no schema change, no migration, no matrix change** ·
**supersedes [ADR 0062](./0062-utilization-report-two-series-and-timesheet-disclosure.md)
§1, §3, §7, §8 and §9**; 0062 §2 (submitted-only + coverage), §4 (billable-only cohort),
§5 (employment-window membership) and §6 (PTO beats a role, over-allocation unclamped)
**stand unchanged** · the surface is documented in
[domains/utilization.md](../domains/utilization.md)

## Context

[ADR 0062](./0062-utilization-report-two-series-and-timesheet-disclosure.md) shipped the report
a day earlier and got the *definitions* right. What it got wrong was the **shape**: it put
**both** series in front of the reader everywhere, which meant every hours-bearing column came in
pairs (planned, confirmed, variance, planned %, confirmed %) on a table that already had eleven
columns. The page was unreadable, and the thing a reader actually wanted — *is this figure near
plan or not?* — was left as mental arithmetic on every row.

Four other things showed up once there was a real page to read:

- The **tentative-role forecast toggle** made every figure softer than it looked, at full weight,
  for no stated reason (0062 §8 knew this and shipped it anyway, behind a constant).
- The **line-of-business card counted days on one side and hours on the other**, which meant its
  two columns were never comparable — and it attributed PTO to a person's home practice even when
  a client was paying for them to be somewhere.
- **PTO and bench compared two different populations.** The planned side counted full-time staff
  only; the logged side summed everyone. That is a bug, not a definition.
- The **own-row disclosure path** (0062 §3: scope the timesheet queries to the viewer, show their
  row, mark everyone else "restricted") produced a page that was mostly the word "restricted".

## Decision

### 1. One basis at a time, with the other series spent on deviation flags — supersedes 0062 §1

A **`Planned | Logged` segmented control** at the top of the report picks which series **the whole
page** shows. Planned is the default. Both series are still computed — `HoursSeries { planned,
confirmed, variance }` is untouched — the toggle only chooses what renders, via `pickBasis`,
`hoursFor` and `shareFor`. A new **`HoursMetric`** pairs a `HoursSeries` with each series' share of
its denominator, so one value drives both the hours cell and the percentage cell on either basis.

**0062 §1's premise survives; only its layout doesn't.** The series are still never summed, and the
gap is still the finding — but the gap is now surfaced as a **flag** rather than as a second column
on every row. On the **Logged** basis a figure far enough from plan gets one:

- **`DEVIATION_THRESHOLD = 0.2`** (20% relative, roughly a day a week) **and**
  **`DEVIATION_FLOOR_HOURS = 8`** (`= HOURS_PER_DAY`, one working day absolute). **Both** gates
  must clear. Relative alone flags noise on a small plan (4 h planned vs 6 h logged is a "50%
  miss"); absolute alone flags big-but-proportionate numbers on a large one. `hoursDeviation`
  returns the signed fraction, `deviates` applies both gates.
- **`DeviationFlag`** (an inline icon + tooltip beside a figure — table cells, and the Utilization
  tiles through `StatCard`'s `marker` slot, see §11) and **`DeviationNotice`** (a section-level
  `InlineNotice tone="destructive"`, used once — full-time project hours in the Utilization
  section). **Both render nothing on the Planned basis**, so a reader who never touches the toggle
  never sees a comparison they didn't ask for.
- `CoverageNote` became **`BasisNote`**: on Logged it carries 0062 §2's submitted-week coverage
  caveat verbatim **plus the flagging rule inline** ("more than 20% *and* 8 hours away from plan",
  rendered from `DEVIATION_THRESHOLD`/`DEVIATION_FLOOR_HOURS` rather than hardcoded, so the copy
  can't drift from the gates); on Planned it states which series is on screen and, for a viewer
  without access, why Logged is unavailable. The caveat now follows the basis instead of standing
  permanently — and, since the filter bar dropped its per-control fine print (§11), `BasisNote` is
  the **only** place either explanation appears.

**Alternative rejected:** keep both series and let the reader collapse columns. That is a table
feature nobody asked for, and it leaves the default state — the one everybody sees — unreadable.

### 2. Tentative roles are gone entirely — supersedes 0062 §8

The read now selects `eq(projectRoles.status, ROLE_STATUS.confirmed)` instead of
`inArray([tentative, confirmed])`. `TENTATIVE_WEIGHT`, the `includeTentative` input, the "Forecast"
switch and `UtilizationRole.status` are **all deleted**.

0062 §8's own reasoning is what killed it: **there is no win-probability field anywhere in the
schema**, so a tentative role could only be counted at full weight — which quietly asserts that
every unwon forecast will land. A tentative role is a *forecast*, not an allocation, and a
utilization figure that mixes the two describes neither. Deferring the tiers behind a named
constant looked cheap; in practice it meant every figure on the page was softer than it looked,
and the toggle's own fine print had to admit it.

The filter bar is consequently exactly **basis + line of business + period** — one control per
question a reader actually asks. If probability tiers are ever wanted, they need a schema field
first, and then a *forecast* surface of their own — not a switch on the actuals report.

### 3. Line-of-business alignment: per person, hours on both sides, and leave follows the project — supersedes 0062 §7

`buildLobAlignment` returns **one `LobAlignmentRow` per person** (it used to return one row per
practice), carrying `planned: LobHours` and `logged: LobHours | null` where
`LobHours = Record<LineOfBusiness, number>` with **every** practice always present
(`emptyLobHours()`), plus `plannedTotal`/`loggedTotal`. `sumLobAlignment(rows)` aggregates the
**visible** rows into the table footer, so the total always describes the table the reader is
looking at rather than an unfiltered cohort.

**Both sides count hours.** 0062 §7 counted *days* on the planned side (with a "top role wins"
tiebreak) and hours on the actuals side, so its two columns were never comparable — and under a
basis toggle they would have silently changed units when the reader flipped it.

**The attribution rule, identical on both bases** — the important part, because none of it is
self-evident and no type states it:

| Time | Practice |
|---|---|
| Project time | the line of business of the **project role** that person held |
| Leave taken **while staffed on a project** | that **project's** practice |
| Leave taken while unstaffed | the person's **own** practice |
| Unallocated / bench time | the person's **own** practice |
| Internal admin | **excluded entirely** |

Leave-follows-the-project is the change worth arguing for: **the client is carrying the cost of
that person being away.** A practice whose staff are booked out and on holiday has its capacity
consumed by that engagement; sending those hours home (0062 §7's rule) made the receiving practice
look busier than it was and the paying one look freer. Bench and unstaffed leave go home for the
mirror reason — nobody else is carrying that time.

Planned reads role `hoursPerDay` per covering role, 8 h for a full-timer's PTO day, and the
unstaffed remainder of a full-time day as bench. Logged reads submitted `time_entries`, with hours
booked to a project the person was never staffed to falling back to their own practice — forced by
the model, since **`projects` carries no line of business, only its roles do**
([ADR 0033](./0033-line-of-business-on-role-derived-project-status.md)). That fallback is the one
place the two bases can legitimately disagree.

The card renders Name · Type · Role · Line of business, then one percentage column per practice,
with the person's home practice in **bold** and zero as "—" so the columns carrying something stay
scannable.

### 4. PTO and bench are full-time measures on **both** sides — and the population bug that hid it

`buildPtoSummary` narrows its cohort to `isFullTime`, so `totalDays`, `peopleWithPto` /
`peopleWithoutPto`, the record-length stats and the hours all exclude hourly staff. Planned leave
books against a fixed working week an hourly person doesn't have, so there is nothing to book it
against and nothing to compare it to.

**The bug this fixed:** `buildUtilizationSummary` previously summed *logged* PTO and bench across
**everyone** while the planned side counted full-time only, so those two rows compared two
different populations under one heading. Logged PTO and bench are now accumulated **inside** the
full-time branch. Per person, `StaffBreakdownRow.pto`/`bench` are `HoursMetric | null` — `null`
for non-full-time staff, rendered **"n/a"**, never `0`.

Hourly staff are no longer merely *excluded*, though: the Utilization card gained a
**Part-time project hours** tile with `hourlyProjectShare` (their share of all project hours) in
its hint. Before, part-time people were subtracted from every denominator and never measured
anywhere.

### 5. Internal admin is dropped

The fourth `UtilizationSplitRow` is gone — the key union is now `"project" | "pto" | "bench"` — and
the per-person entry fold (`EntryTotals`/`addEntry`, now `LoggedTotals`/`buildLoggedTotals`) drops
`INTERNAL_ADMIN` outright. It had **no planned counterpart** (the plan
has no bucket for overhead), so its row only ever half-filled, and it belongs to no practice, so it
had nothing to say in the LoB card either. Dropping it is cheaper than maintaining a row that is
structurally `null` on one side forever.

### 6. Logged access is gated **cohort-wide**; the own-row path is gone — narrows 0062 §3

`getUtilizationReport` no longer resolves `ownStaffId` and no longer scopes the timesheet reads
with a SQL predicate. **Without `timesheets.edit` it skips both timesheet queries entirely** — not
even the viewer's own rows are fetched. `confirmedStaffIds: string[] | null` was replaced by a
single **`canViewLogged: boolean`** (the same field name on `UtilizationReportData`,
`UtilizationInputs` and `CoverageSummary`); the per-row `hasConfirmedAccess` flag and the
`canSeeConfirmed` predicate are deleted. The **Logged toggle is disabled** for such a viewer, with
the reason in `BasisNote` (§11 removed the filter bar's duplicate of that line).

**This only ever tightens disclosure**, which is why it needs no matrix change and no re-audit of
the gate itself: the population that may read cross-person logged hours is unchanged
(`timesheets.edit`, still reused rather than widened), and the population that may not now reads
*fewer* rows than before — zero instead of their own. Verified against the real database: on the
no-access path, **zero timesheet rows are fetched and every logged figure is `null`**.

The reason to drop the own-row path is that a **single-basis** report makes it worthless. Under
0062's two-column layout, one populated row among many "restricted" ones was still a page. Under a
toggle, choosing "Logged" would render a whole report of em dashes with one real row in it — worse
than not offering the basis. Their own logged hours are one click away on `/timesheets`, which is
where a person's own timesheet has always lived.

The **`null`-never-`0` discipline is unchanged** (0062 §3's third bullet stands), and the report
itself remains **ungated** for any signed-in user on the Planned basis.

### 7. Period presets and period-to-date — supersedes 0062 §9's default

`utilization-range.ts` gains **`RANGE_PRESETS = ["thisMonth","lastMonth","thisQuarter","thisYear"]`**,
`RANGE_PRESET_LABELS`, `presetRange(preset, today)` and `matchingPreset(range, today)`.
`currentMonthRange()` is **deleted**; the default window is `presetRange("thisMonth")` — the
current month **to date**, not the whole calendar month.

**Period-to-date is the point.** An in-progress month, quarter or year **ends today**; a window
running into the future counts capacity nobody has had the chance to log against yet, so every
logged figure reads as a shortfall and every deviation flag fires for a reason that has nothing to
do with delivery. "Last month" is complete by definition, so it is the whole month.
`MAX_RANGE_DAYS = 366` still covers every preset, leap year included.

`parseUtilizationRange` takes an optional third **`today`** argument, and the page resolves `today`
**on the server** and passes it down, so the preset highlight can't disagree with the window the
page defaulted to across a timezone boundary. The URL contract (`?start=&end=`), the
degrade-don't-error parsing and the 366-day cap are unchanged from 0062 §9.

**The ◀ ▶ arrows are not.** 0062 §9's window-length stepping *broke* the moment presets became
period-to-date: on the 3rd of the month the default window is three days long, so "previous" landed
on a three-day sliver of the previous month rather than on the previous month. New
**`shiftRange(range, direction, today)`** steps **whole calendar periods** when the window *is* a
calendar period:

- Whether it is one is read off **the window's own shape** by a private
  **`periodUnitOf(range, today)`** — month, quarter or year, accepting either a whole period or one
  in progress that ends today, with the **smallest unit winning** (early January is simultaneously
  month-, quarter- and year-to-date; month is what the filter bar highlights, so month is what the
  arrows step).
- **Deliberately not via `matchingPreset`.** Shape-detection keeps stepping correct after the
  reader has stepped *away* from a preset (a window two months back matches no preset but is still
  a month), and it makes stepping **reversible** — back then forward returns the window you started
  from, which a preset-anchored implementation cannot promise.
- A stepped period containing today still **stops at today**; one wholly behind or ahead is shown
  **in full**, so stepping forward is how a reader looks at the plan ahead. A **hand-picked** window
  has no period to step and keeps sliding by its own length.

Seven of `utilization-range.test.ts`'s tests cover this, including the reversibility property and
the original three-days-back regression.

### 8. Section order, and client-side search/filter/pagination on both tables

**Order:** Headcount → Roles → Bench → PTO → **Utilization** → Staff breakdown → Line of business
alignment. Utilization used to be first; it now sits *after* the roster and leave context that
explains it, because "47%" means nothing until you know who is in the denominator and how much of
the period was leave.

**Both per-person tables** got name search, a Type segmented filter, a Role select and pagination
(`staff-table-filters.tsx`: `useStaffTableFilters()`, `StaffTableFilters`, `paginate()`,
`REPORT_PAGE_SIZE = 20`). Each table owns an **independent** instance — they answer different
questions, and someone narrowing one has no reason to be narrowing the other. Page state **resets
to 1 on any filter change**, since page 4 of the full roster is usually past the end of a filtered
one.

**All of it is client-side**, because the whole cohort is already in one fetched projection and
routing these filters through the URL would re-run a six-query read on every keystroke — the same
reasoning 0062 §9 used for the line-of-business filter. To support it,
`src/components/pagination-controls.tsx` was refactored: the strip layout moved into a private
`PaginationStrip`, with **`PaginationControls`** (link-based, URL state — **unchanged API**, still
used by the CRM/projects lists) and a new **`ClientPaginationControls`** (`onPageChange`) on top.

### 9. Column and read cleanups

- **Staff breakdown** is now Name (→ `/staff/{id}`) · Line of business · Type · Role · Available ·
  Project · Project % · PTO · PTO % · Bench · Bench %. The *Weeks* column and the
  Planned/Confirmed/Variance/Planned %/Confirmed % set are gone — the basis picks one figure per
  column, and per-person coverage was a column nobody read.
- **"Discipline" → "Role"** in the Staff breakdown and the Headcount table, matching the field's
  actual name everywhere else in the app.
- The **`projects` join and the unused `projectName`** field are gone from `UtilizationRole` and
  the projection.
- `utilizationFilterOptions` now feeds **three** dimensions: line of business (the cohort), role
  and employment type (the two tables).
- The page is **`max-w-7xl`** (was `max-w-6xl`), matching the projects list, because the breakdown
  table is wide.

### 10. The seed now has hourly staff

`scripts/seed/staff.ts`'s `makeEmployment()` takes an `employmentType`, and **~15% of ICs are
`HOURLY`**. All 42 seeded people were `FULL_TIME`, which left the part-time tile, the "n/a"
capacity cells and the Type filter unexercised — none of them had ever been seen with data.

### 11. The Utilization section is six tiles, not a table — and the filter bar is one panel

Two layout follow-ups, both consequences of §1 that only became visible on the built page.

**Tiles.** The three-column `Full-time time | Planned-or-Logged | % available` table (project / PTO
/ bench rows, an **Available / 100%** footer) is **deleted**. The Utilization section is now a
3-column grid of six `StatCard`s: **Available hours · Utilization · Part-time project hours**, then
**Full-time project hours · PTO hours · Bench hours**. Each of the latter three carries its share of
available hours in the hint (plus `formatPercentDelta(…) vs plan` on Logged) and a `DeviationFlag`
in a new **`marker?: ReactNode`** slot on `StatCard` — documented there as *a warning marker, not a
second figure*, because `StatCard` is shared with the home and performance dashboards. The
section-level `DeviationNotice` for full-time project hours stays.

**Under one basis a table row carried exactly one number**, which is a stat, not a table: the grid
that justified three columns was the two-series layout §1 removed. **There is deliberately no total
tile** — project + PTO + bench reconciles to available hours *by construction* (PTO beats a role),
so a total would only restate a figure that agrees with itself, and over-allocation already shows up
as a share above 100%.

The API deletions that follow, because they matter to anyone adding a tile here:

- **`UtilizationSplitRow` and `UtilizationSummary.rows` are gone.**
- **`projectHoursFullTime: HoursSeries` → `fullTimeProject: HoursMetric`**, and the summary now also
  exposes **`pto` and `bench` as named `HoursMetric` fields** — a tile needs an hours figure *and* a
  share from one value, which is exactly `HoursMetric`.
- **`UtilizationSummary.utilization: { planned, confirmed }` is deleted as redundant** — it was
  precisely `fullTimeProject.plannedShare` / `.confirmedShare`. The utilization *rate* is read off
  that metric's share, so one definition of "project hours ÷ available hours" exists rather than two
  that can drift.
- **`emptyLobHours()` is no longer exported** (internal to the math module), and
  **`formatHoursDelta` is deleted** — it had no callers once the variance columns went.

**One filter panel.** `utilization-filters.tsx` became a single bordered panel (`rounded border
p-4`) with two rows split by a hairline: **Date range** (the ◀ / start / – / end / ▶ group,
`size="icon-sm"` chevrons, labelled "Date range" rather than "Period") → **Line of business** →
**Basis** (`size="sm"`) on top; the four period shortcuts as `size="xs"` buttons on the left below,
with one short caveat line on the right ("An in-progress period runs to today. The arrows step whole
periods; a hand-picked range slides by its own length.").

The **three per-control fine-print paragraphs are gone.** Prose hanging under individual controls
left the row ragged and pushed each control to a different baseline, and the only line worth keeping
— "Logged hours require timesheet access" — was a **duplicate** of what `BasisNote` already says
directly above the first card, where a reader who just clicked a disabled segment is looking anyway.
One caveat line for the whole panel, one explanation of the gate, in one place.

## Consequences

- **`timesheets.edit` is still the only gate, and it is now strictly cohort-wide.** Anyone auditing
  that capability counts this report; the own-row carve-out no longer exists to reason about.
  [permissions.md](../domains/permissions.md) and [timesheets.md](../domains/timesheets.md) say so.
- **A reader must know which basis they are on.** Every hours figure on the page is one series, and
  since §11 removed the Utilization table's Planned/Logged column header the only in-page signals
  are **the toggle and `BasisNote`**. Any new card **must** take `basis` and use `hoursFor` /
  `shareFor` — a card that renders `series.planned` directly will silently lie on the Logged basis.
- **Deviation flags exist only on Logged.** If a future card wants to surface the comparison on the
  Planned basis, it needs a different affordance; `DeviationFlag`/`DeviationNotice` deliberately
  return `null` there.
- **`formatHoursDelta` is deleted** — the variance columns it served are gone, and nothing formats an
  absolute hours delta any more (§11). `formatPercentDelta` is the only gap formatter.
- **`StatCard` now has a `marker` slot** (`src/components/stat-card.tsx`), used only by this report so
  far. It is a shared tile: keep the slot for warning markers, not for a second number.
- **Tentative roles are invisible here.** "What does the pipeline do to our capacity?" is now
  *unanswered anywhere* — the allocations planner's capacity meter still counts tentative load
  ([ADR 0060](./0060-allocations-capacity-meter.md)), so the two surfaces deliberately disagree
  about the same person. That is the intended split: the planner forecasts, the report measures.
- **The Logged basis looks near-empty on seed data.** The seed carries only ~4 weeks of timesheets,
  so a year-to-date window reads ~3% coverage. Check `BasisNote` before concluding anything locally.
- **The capacity baseline is still flat** (8 h × Mon–Fri for full-timers). `utilizationTarget`,
  part-time hours/week, mid-day joiners/leavers and holiday calendars remain unmodelled — the same
  gap the planner's meter has.
- **60 tests** (`utilization-report.test.ts` ×38, `utilization-range.test.ts` ×22) — the
  [ADR 0037](./0037-unit-tests-removed-except-rbac-matrix.md) carve-out 0062 opened, rewritten to
  match. They pin the two deviation gates, the LoB attribution rule on both bases, the full-time
  narrowing of PTO/bench, `canViewLogged`'s `null`-not-`0` behaviour, period-to-date, and
  `shiftRange`'s whole-period stepping (including reversibility).
- **No schema change, no migration, no matrix change.** `permissions.ts`, its test and
  permissions.md's matrix are untouched; only permissions.md's *narrative* about this report moved.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Keep both series everywhere (0062 §1) | Doubles every column on an eleven-column table; the default state — what everybody sees — was unreadable (§1) |
| A per-table "show comparison" column toggle | A table feature nobody asked for, and it leaves the default unreadable anyway (§1) |
| Deviation on relative threshold alone | Flags a 4 h-vs-6 h plan as a 50% miss — noise, not news (§1) |
| Deviation on absolute hours alone | Flags large-but-proportionate figures on big plans and misses real misses on small ones (§1) |
| Keep the tentative toggle until probability tiers land | The tiers need a schema field that doesn't exist; meanwhile every figure was softer than it looked and the fine print had to admit it (§2) |
| Keep counting planned LoB in **days** | Under a basis toggle the card would change units when the reader flips it, and the two columns were never comparable anyway (§3) |
| Attribute leave to the person's home practice always (0062 §7) | The client is paying for the person to be away; sending the hours home flatters the receiving practice and frees the paying one on paper (§3) |
| One row per practice in the LoB card | Hides *who* is off-practice, which is the only actionable version of the finding (§3) |
| Sum the LoB footer over the whole cohort | The footer would describe rows the reader can't see once a filter is on (§3) |
| Keep summing logged PTO/bench across everyone | Compares two populations under one heading — it was a bug, not a definition (§4) |
| Keep an `internalAdmin` row | No planned counterpart and no practice; structurally half-empty forever (§5) |
| Keep the own-row logged path (0062 §3) | Under a single-basis toggle it renders a page of em dashes with one real row; their own hours are already on `/timesheets` (§6) |
| Add `timesheets.view` so more people get the Logged basis | Still a matrix change ([ADR 0014](./0014-rbac-better-auth-access-control.md) lockstep) for an audience nobody has asked for; recorded as the named path if it ever is (§6) |
| Default the window to the whole calendar month (0062 §9) | Counts future capacity nobody could log against, so every logged figure reads as a shortfall and every flag fires (§7) |
| Resolve `today` in the browser | The preset highlight could disagree with the server-defaulted window across a timezone boundary (§7) |
| Keep sliding the arrows by the window's length (0062 §9) | Period-to-date presets make the current window a few days long early in a period, so "previous" landed on a sliver of the previous month (§7) |
| Detect the steppable period via `matchingPreset` | Stepping would stop working as soon as the reader stepped away from a preset, and back-then-forward wouldn't return the original window (§7) |
| Keep the project / PTO / bench split as a table | Under one basis each row carried exactly one number — a stat, not a table; the second column that justified it was the two-series layout §1 removed (§11) |
| Add a total (or "Available / 100%") tile | Project + PTO + bench reconciles to available hours by construction, so it would only restate a figure that agrees with itself (§11) |
| Keep `UtilizationSummary.utilization` alongside `fullTimeProject` | It was exactly that metric's share — two definitions of one ratio, free to drift (§11) |
| Keep the per-control fine print in the filter bar | Ragged rows and mismatched baselines, and its one load-bearing line duplicated `BasisNote` directly below it (§11) |
| Put the table search/type/role filters in the URL | Re-runs a six-query read on every keystroke to slice an array already in the client (§8) |
| Give `PaginationControls` an optional `onPageChange` | Two navigation modes on one component's API; a private shared strip with two thin wrappers keeps the link-based contract the CRM/projects lists rely on exactly as it was (§8) |
</content>
