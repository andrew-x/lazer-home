# 0063 — The home dashboard's two time bases: year-to-date for you, point-in-time for the org

**Status:** accepted · 2026-08-03 · **complements, does not supersede,**
[ADR 0062](./0062-utilization-report-two-series-and-timesheet-disclosure.md) — the
Utilization report stays exactly as specified there; this records a *third* kind of
number and forbids merging it with either of 0062's two series · **reuses**
[ADR 0038](./0038-allocations-planner-pto-disclosure.md)'s PTO split and
[ADR 0041](./0041-allocation-notes-on-staff.md)'s notes gate **with nothing new
disclosed** · no schema change · **no permission-matrix change**

## Context

The home dashboard (`src/app/(app)/page.tsx`) had two bands — "Your work" and "The
organization" — and both computed *utilization* from submitted timesheets over the year to
date (`src/lib/timesheets/utilization.ts`, plus a deleted `getOrgUtilization` read backing
an org cohort table). Three problems, all live before this change:

- **The org figure answered a question nobody asked.** A staffing lead opening the home
  page wants *right now, how much of the bench is working?* A year-to-date average over
  cohorts cannot answer that, and buries it.
- **It inherited timesheet coverage as if it were utilization.** Submission discipline is
  partial. The org table's low numbers were largely un-logged weeks, not idle people —
  the exact failure mode 0062 spends a section guarding against on its own page.
- **Two different numbers wore the same word.** "Utilization" appeared in both bands
  meaning different things over different windows, with nothing on screen saying so.

Separately, "Your work" had a stat tile counting active projects (listing their names in a
hint string) and a gantt drawing the same projects as bars. Neither gave the figures people
actually came for: when does this start, when does it end, how much of me does it want.

## Decision

**Keep both time bases. Name the window on every figure. Never unify them.**

### 1. Your Status = year to date. Lazer Status = point in time

- **Your Status** — cumulative, 1 January through today, from **submitted timesheets**
  via `getStaffUtilization` → `computeUtilization`. Unchanged arithmetic; every tile hint
  now says so ("… · YTD, N weeks in 2026"). A point-in-time *personal* figure would swing
  on one day's logging and be noise.
- **Lazer Status** — instantaneous, from the **staffing plan** (`project_roles`) as of
  today, via the new pure `src/lib/home/org-status.ts` over `getAllocationsGrid`. It
  reads **no timesheets at all**, so thin submission can't masquerade as an idle bench.

A person's own utilization is a cumulative fact about their year; the organization's is an
instantaneous fact about today. Collapsing them onto one window destroys one of the two
answers, whichever way you collapse.

### 2. Labelling the window is a requirement, not polish

Because both halves would otherwise be called "utilization", **the bare word is banned on
this page** and every figure states its window: the section descriptions ("Your work this
year — 1 January to today, from your timesheets." / "The whole organization, as it stands
today."), the tile hints, and the Staffing card's `As of <date>` header. Any new figure on
either band inherits this rule.

### 3. The org metric is *staffing*, from the plan — and here is exactly what it means

`summarizeStaffing` in `src/lib/home/org-status.ts`. Definitions, each deliberate:

- **Staffed** = holds **≥ 1 `confirmed` role whose span contains today**. Tentative does
  not commit anyone (the same rule behind `latestConfirmedEnd` and the planner's default
  sort). Someone on **approved leave today is still staffed** — this measures whether the
  plan has them working, not whether they are at their desk. Availability, rendered right
  beside it, is where leave nets capacity out.
- **Population** = `isBillable === true`, byte-identical to `buildAvailability`'s
  `billableStaff`, so the staffing rate and the availability strip can never disagree
  about who counts. (Overhead disciplines hold no project roles; including them would
  only inflate the denominator — the same reasoning as 0062's billable-only cohort.)
- **`rate` = staffed ÷ headcount**; `null` when there is nobody to divide by.
- **`normalizedRate` = staffed ÷ full-time headcount, deliberately uncapped.** Staffed
  hourly people measured against a salaried denominator can push it **over 100%**, and
  that excess *is* the signal: the org is delivering more than its full-time base could.
  `null` when nobody is full time — **never 0**.
- **The breakdown is by discipline** (`staff_employment.role`, the *person's* role), not
  `project_roles.roleType` (the *work's*). "Do we have idle engineers" is a question about
  people. An empty discipline renders "—", never a fabricated 0%.
- **Rows are the five *delivery* disciplines only** — Engineer, Designer, Architect,
  Delivery, QA (`DELIVERY_ROLES`, asserted by test to be exactly the complement of
  `NON_BILLABLE_ROLES` so it can't drift). Overhead disciplines aren't staffed onto client
  work, so "how much of Sales is staffed" isn't a question and four near-permanently-empty
  rows made the real signal harder to read. Anyone in the billable population outside those
  five — an overhead role carrying `isBillable: true`, or no recorded role — lands in an
  **`Other`** row shown only when non-empty, so **the discipline rows always account for
  exactly the same people as Overall**. A breakdown that silently drops someone is worse
  than an odd row.
- **It counts people, not hours.** The hours-weighted version of this question is
  `/reporting/utilization`; duplicating it here would be a fourth number to reconcile.
- **No target column.** A target belongs beside a cumulative figure you could still act to
  hit, not beside a snapshot of today. (`utilizationTarget` is unusable anyway — see
  [ADR 0060](./0060-allocations-capacity-meter.md).)

### 4. No small-cohort suppression — deliberately unlike the deleted YTD module

The old org table carried a `MIN_COHORT_SIZE` guard, because individual **logged hours**
are gated behind `timesheets.edit` and a one-person cohort row would have de-anonymized
them. That reasoning does not transfer: these are **headcounts over allocations
`/allocations` already publishes by name.** A one-person discipline row discloses nothing
new. Don't "restore" the guard by analogy with the other dashboards.

### 5. The Client Component prop is a disclosure boundary

`LazerStatusSection` is a Client Component (§6), so **`buildOrgStatus`'s return value is
serialized into the page HTML for every viewer.** `AllocationStaffRow` carries
`allocationNotes` — manager-only staffing commentary read-gated on `staff.edit` inside
`getAllocationsGrid` ([ADR 0041](./0041-allocation-notes-on-staff.md)) — plus `skills`.
Therefore:

- **`buildOrgStatus` copies every field one at a time and spreads nothing.** A spread
  would silently ship whatever sensitive column somebody adds upstream next. This holds
  for the leave rows too: `UpcomingLeave` is a purpose-built projection carrying no
  `staff` columns, so spreading it would have been safe *today*, but it is enumerated
  anyway — the rule is worth more as an invariant with no exceptions to reason about
  than as a judgement call re-made per field.
- **PTO `type` is passed through, never re-derived.** `getAllocationsGrid` has already
  nulled it for viewers without `pto.review` (ADR 0038); the panel renders the label only
  when present.
- Two unit tests assert the omission **on the serialized payload** rather than on a field
  list, and were mutation-tested: reintroducing a spread fails them. Verified against
  seeded data — 17 staff carried notes upstream, 0 appeared in the payload.

Everything the section *does* show — names, disciplines, lines of business, project names,
allocation spans, approved-leave dates — is already public via `/allocations`, which is why
**no matrix row changed and no capability was added**.

### 6. The section is a Client Component; its filters stay in memory

This is the **first client JS on `/`**, which previously shipped none. The trade was made
for three controls — line of business (whole band), availability week, employment type —
each of which re-slices data **already fetched**. Putting them in the URL would cost a
server round trip to answer "who's free in three weeks", a question people ask by clicking
through all five weeks in a row. This follows the split `/reporting/utilization` already
established: **the range lives in the URL because it bounds a query; filters are client
state because they don't** (0062, *Filters and the window*).

Consequences of client-side filtering, both handled:

- **Counts must be recomputed, not reused.** `summarizeWeeks(people, weekStarts)` was
  **extracted** from `buildAvailability` so the same arithmetic runs on the server over
  everyone and on the client over a filtered subset. Printing the server's unfiltered
  counts above a filtered name list is the classic filtered-dashboard bug.
- **One filter, one meaning.** The line-of-business filter matches each person's **home**
  LoB on every panel, so "Fintech" means the Fintech *team* — including where they've been
  lent out (which is what Borrowed staff exists to show). Filtering on the *work's* LoB
  would make availability incoherent: a free person is on no project and has no work to
  match. **The one exception** is an **open** upcoming role — no holder, so no home LoB;
  it falls back to the role's own LoB, or every unfilled position would vanish the moment
  a filter was applied.

### 7. Your Status: one table replaces a stat tile and a gantt

`MyAllocationsTable` (Project · Client · Dates · Hours/day), live rows first then an
"Upcoming" divider. A gantt shows *shape*; a dashboard is read for *figures*. Both deleted
widgets went, along with `allocation-timeline.tsx` and `src/lib/home/allocation-timeline.ts`.

Two follow-on rules:

- **`getMyAllocations` no longer clips to a display window.** It was bounded to the gantt's
  −1/+2 months; it now returns everything with `endDate >= today` and **no forward bound**,
  because a table whose job is "what's next" must not hide a role starting next quarter.
- **No planner link in this section.** Your Status is about your own commitments;
  `/allocations` is a staffing tool for someone else's job.

### 8. `openRoles` was added to `getAllocationsGrid` additively, at zero query cost

Unfilled positions are the most actionable rows on the page, so `AllocationsGridData`
gained `openRoles: OpenRoleRow[]` (`Omit<AllocationRoleRow, "staffId">` — the field is
dropped rather than made nullable, keeping "a role row always has a person" true of
`AllocationRoleRow`). `isNotNull(staffId)` came **out of the WHERE clause** and the
staffed/open split now happens in JS over one result set: `roles` is unchanged for every
existing consumer (planner grid, availability, utilization) and there is **no extra round
trip**.

## Consequences

- **`src/lib/timesheets/utilization.ts` now serves exactly one caller** — the personal
  tiles. `splitByEmploymentType`, `weightedTargetOf`, `UtilizationGroup`,
  `UtilizationRecord` and `MIN_COHORT_SIZE` were **deleted** with the org table, as was
  `src/actions/timesheets/getOrgUtilization.ts`. `computeUtilization`, `buildPlanRow` and
  `allocatedHoursInRange` remain. **Don't grow a third org aggregator there**: point-in-time
  belongs in `org-status.ts`, plan-vs-actuals in `src/lib/utilization/utilization-report.ts`.
- **Three surfaces now measure "utilization", and they are three different questions.**
  Keep them apart:

  | Surface | Window | Source | Unit |
  |---|---|---|---|
  | Home → Your Status | year to date | submitted timesheets (own) | hours ratio |
  | Home → Lazer Status | **today** | `project_roles` plan | **people** |
  | `/reporting/utilization` | a chosen range | plan **and** actuals, two series | hours |

- **`buildBorrowed` duplicates a question `/reporting/utilization` also asks**, on purpose:
  `buildLobAlignment` measures cross-LoB drift as a day-weighted aggregate over a range;
  this names the specific people, today. "How much drift" and "who, right now" are different
  needs — keep both.
- **The availability panel became interactive, and its tabs are deltas.** Tab 0 is the
  **bench** — everyone idle now. Each later tab lists only whoever **newly frees up** that
  week (`buildAvailabilityTabs`: free in week `i`, not free in week `i−1`). Two rejected
  alternatives: the original static strip keyed each person to their *first* free week, so
  it could not answer "who's free in three weeks" at all; a cumulative per-week list could,
  but re-printed the standing bench in all five tabs and buried the two people whose project
  actually ends that week — the only names that tab exists to surface. The transition is
  keyed on the *previous* week rather than "not free earlier", so somebody who finishes,
  gets restaffed and finishes again appears **both** times; the second occasion is precisely
  the one nobody has planned around. Consequence, stated deliberately: the tab counts do
  **not** sum to "people with capacity", and only tab 0 shows total availability — `freeFte`
  (from the cumulative `summarizeWeeks`) carries the capacity view alongside.
- **Starting and ending are two cards, grouped by project.** They began as one card with two
  lists, which read as a single mixed feed and buried whichever half was shorter; they prompt
  different work (find people vs. find their next engagement) and are often read by different
  people. Within each, roles are grouped by project (`groupRolesByProject`): roles are stored
  one per seat but sold and staffed per engagement, so three engineers rolling onto one
  project in the same week is *one* thing to plan for, and a flat list interleaving unrelated
  projects hides that shape.
- **`InlineNotice` had to stop being a Client Component.** Its needless `"use client"` made
  the `icon` prop — a component *reference* — unserializable from a Server Component, which
  crashed the home page's "no staff record" branch. The directive was removed (it holds no
  state, handlers or browser APIs). **Don't re-add it**; a plain module imported by a
  `"use client"` module is simply bundled into that chunk.
- **The seed had to change to make the new figures demonstrable** (`scripts/seed/`): ~15%
  of non-management staff are now `HOURLY` (previously everyone was `FULL_TIME`, so the
  Hourly filter was always empty and `normalizedRate` printed the same number as `rate`),
  and ~20% of projects are "upcoming", starting within 60 days (previously every role
  started in the past, so *Upcoming roles → Starting* was always empty).
- **Still not a capacity model.** The baseline stays a flat 40h week for everyone; nothing
  here reads `utilizationTarget`, part-time, joiners/leavers or holidays. See
  [domains/allocations.md](../domains/allocations.md) → *Open questions*.

## Alternatives rejected

- **Make the org figure year-to-date too, for consistency.** Rejected — consistency of
  *window* at the cost of the only question the band exists to answer, and it re-imports the
  timesheet-coverage confound onto a page that has no room to caveat it.
- **Make Your Status point-in-time too.** Rejected — a personal snapshot swings on a single
  day's logging; the cumulative figure is the one someone can act on.
- **Drive Lazer Status from `buildUtilizationReport` instead.** Rejected — that module is
  built around a *range* and a day-level ledger per person, and its confirmed half is gated
  on `timesheets.edit`. Reusing it would either drag a gate onto an open band or force a
  range control onto a "today" question. It *is* reused for the shared vocabulary, not the
  computation.
- **Suppress small discipline cohorts** (see §4). Rejected as a false analogy.
- **Server-side filters via the URL.** Rejected (§6) — a round trip per click for data
  already on the page.
- **Keep the gantt beside the new table.** Rejected — two widgets for one question, and the
  gantt was the half that couldn't state a date.
