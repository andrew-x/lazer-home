# 0070 — Finance report: a fixed fee prorated by billable hours, server-side aggregation in both currencies, and per-discipline rates that stop at the fee

**Status:** accepted · 2026-08-04 · **renumbered from a duplicate 0068** on 2026-08-04, when 0068
was independently taken on `main` by
[0068](./0068-delivery-managers-as-project-roles-and-coverage-gaps.md) ·
**no schema change, no migration, no matrix change** ·
**refines [ADR 0066](./0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md)**
(a fee is now attributable to *time*, still never to a *role*) and departs deliberately
from [ADR 0062](./0062-utilization-report-two-series-and-timesheet-disclosure.md) /
[0064](./0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md) on where
filtering happens · the surface is documented in
[domains/finance.md](../domains/finance.md)

## Context

Revenue and margin existed only **one project at a time**: `computeProjectMargin` over a single
plan, rendered in that project's budget panel, plus a precomputed margin column on the projects
list. Nothing answered a portfolio question — *what is the book worth this quarter, at what margin,
at what blended rate* — and the answer was not derivable by eye from a list of per-project figures,
because a fixed fee spanning the window edge does not belong wholly to either side of it.

Two constraints bounded what such a report could honestly say, and both are load-bearing below:

- **There is no path from timesheets to revenue.** `time_entries.projectId` points at a *project*,
  never at a `project_role`, so an hour is never attached to the rate it would bill at. Every
  figure had to come from the plan.
- **A fixed fee is not attributable to a role** (ADR 0066 / ADR 0053 §5). Any per-period or
  per-discipline breakdown of a fee had to either find a defensible basis or decline.

## Decision

### 1. Plan-based only, and it says so — no `Planned | Logged` basis toggle

Every figure is `billRate × weekdays in span × hoursPerDay`, from `project_roles`. The report gets
**no basis toggle**, unlike `/reporting/utilization`: there is no logged-money series to toggle
*to*, because no schema links an hour to a rate. An `InlineNotice` on the page states this in
words, and the page description says "committed billings, not invoices".

This is not a caveat we can drop later by improving the UI — it needs a `time_entries →
project_role` link first. Until then, "revenue" here means *what the plan is committed to bill*.

**Consequence to accept:** the report is only as good as the rate card, and
`DEFAULT_BILL_RATE = 250` with an empty `BILL_RATE_EXCEPTIONS` is a documented placeholder. The
report is structurally correct and numerically fictional until real rates land — which also makes
the off-standard-rate figure read as ~0%. That is the card being uniform, not the measure being
broken.

### 2. A fixed fee is prorated by billable hours — refines ADR 0066

In-period fixed-fee revenue is `fee × (billable hours in the window ÷ billable hours of the whole
plan)`. The defining property, and the reason this is a *recognition schedule* rather than an
invented number:

> **Contiguous windows partition the fee exactly.** Twelve months of a one-year engagement sum back
> to the whole fee — no more, no less.

`feeRecognitionShare` is pinned to that property by test. It follows the delivery shape, so a
front-loaded project recognizes more early, and it nets out nothing for leave (consistent with
`countsTowardBudget`, where PTO is deliberately not deducted).

**ADR 0066's prohibition is refined, not relaxed.** A fee is now attributable to **time**; it is
still never attributable to a **role**. The two are different claims: time is a basis every role on
the plan shares, whereas splitting a fee across roles would assert that *this* engineer earned
*that* slice of a single negotiated price.

Rejected: **straight-line by calendar days.** Simpler to explain, but it recognizes revenue in
months where the plan has almost no staffing, which is exactly when a finance reader is looking for
a problem.

Rejected: **exclude fixed fees from the in-period column.** Honest, and it needs no new definition
— but it would leave in-period revenue covering T&M only, understating the portfolio without
saying by how much.

### 3. The share always divides by the whole plan, never by the slice

`feeRecognitionShare` takes both the slice being priced and `allRoles`, and the denominator is
**always** the whole plan.

This was a real bug caught in testing, not a hypothetical. With the denominator over the *filtered*
roles, every share came out 1 — so filtering a multi-practice fixed-fee project to one line of
business reported the **entire fee** against that practice, and the five per-practice views each
claimed all of it. With the whole plan underneath, the shares partition: practices sum to 1,
contiguous windows sum to 1, and a filter combined with a window multiplies out correctly.

**Both time bases are sliced this way**, not only the in-period one. A practice view whose
"overall" column showed the whole fee beside its own prorated half would invite precisely the wrong
subtraction. Unfiltered, the practice share is exactly 1 and "overall" is the untouched plan — so
the unfiltered view of a project agrees to the dollar with that project's own budget panel, which is
the cross-check a reader is most likely to perform.

### 4. One margin engine, called twice — no second implementation

The report does **not** reimplement revenue or cost. It clips each role's dates to the window,
scales the fee by the share, and calls `computeProjectMargin` again:

- **overall** — roles as stored, fee scaled by the practice share.
- **inPeriod** — roles clipped to the window, fee scaled by the practice × window share.

Because `computeProjectMargin` derives hours from `startDate`/`endDate`, the clip yields in-window
hours, T&M revenue **and** cost for free, with revenue and cost clipped *identically* — so the
margin percentage stays coherent rather than dividing a whole-span cost by a partial revenue.
Passing a scaled `budgetAmount` prorates the fee with **zero changes to `project-margin.ts`**.

This is why `feeRecognitionShare` expresses proration as a *scaled fee* rather than as a
post-hoc multiplication of the result: a report that computed its own revenue would eventually
disagree with the project it aggregates, and a finance report that disagrees with its own source is
worse than no report.

A side effect worth naming rather than hiding: `inPeriod.countedRoleCount` becomes **"roles active
in the period"**, because a role that doesn't overlap the window is dropped rather than clipped to
zero (an inclusive date pair cannot express "no days").

### 5. Gated on `projects.viewMargin` — no new capability, no matrix change

`FINANCE_REPORT_ACCESS = { projects: ["viewMargin"] }`, declared beside the math in
`src/lib/finance/finance-report.ts` so the route, the nav item and the read resolve one constant —
the pattern `PROFILE_COMPLETENESS_ACCESS` established. Holders: `finance`, `delivery-manager`,
`manager`, `admin`.

These roles already read a project's cost and margin on its own detail page; this re-aggregates the
same compensation-derived disclosure rather than exposing a new *kind* of fact. So
**`permissions.ts`, `permissions.test.ts` and `docs/domains/permissions.md` are untouched.**

Revenue alone would not need this gate. It is gated anyway because the page's whole point is revenue
**and** margin side by side: a revenue-only variant would be a different report, and splitting the
surface in two to avoid one capability check would double the number of places a portfolio total is
computed.

The read `requirePermission`s and **throws** rather than masking — unlike `getProjectCostBasis`,
which withholds cost so the rest of a project page still renders. Here there is no useful
remainder. Cost inputs still come from `getProjectCostBasis`, which re-derives the same decision:
it is the one place that decision is made, and inlining its `staff_employment` projection to skip a
redundant check would be the beginning of a second answer to "may this viewer see cost".

### 6. Both filters in the URL, all aggregation server-side, both currencies precomputed

**This departs from the utilization report deliberately.** ADR 0062/0064 ship one projection and
filter it in the browser. That is safe there because the projection carries nothing sensitive. Here
it is not: **a role's cost divided by its hours *is* that person's hourly compensation**, so a
client-side filter would put every assignee's pay rate in the page HTML for the whole portfolio at
once.

So the report follows the **projects-list** posture (`listMargin` in `getProjectsList`):

- The date range **and** the line of business live in `searchParams`, because both bound the query
  — the window decides which projects are read, and the practice decides which roles are counted
  and therefore how a fee prorates.
- `buildFinanceReport` runs on the server **once per display currency**, and only finished
  aggregates cross to the client. No per-role cost, no per-person hourly cost.
- The currency toggle is client state, picking between two precomputed reports. It discloses
  nothing new, because both were already sent.

Filters round-trip. For a finance report that is a feature, not a cost: a filtered view is
linkable, which is usually what a finance figure needs to be.

### 7. Per-discipline rates: two columns, because one of them stops at the fee

"Average rate per role" is delivered as **two** columns per discipline, not one:

- **Card rate** — the hours-weighted mean of the roles' own stored `billRate`. Defined for *every*
  counted role, fixed-fee ones included: `RoleMargin.billRate` is deliberately non-null there,
  because a *rate* cannot be mistaken for a share of a fee the way an *amount* can.
- **Blended** — revenue ÷ hours, over **time-and-materials roles only**. `null` for a discipline
  whose in-window hours are all fixed-fee, with the T&M hours it does cover shown beside it, and an
  `InlineNotice` explaining why when any discipline is in that state.

Filling the blended column for fixed-fee work would require apportioning a fee across the
disciplines that delivered it — the exact invented number §2 declined to invent. The hours-weighted
mean is also load-bearing over a plain mean: a plain mean of rates lets a two-week role move the
figure as much as a year-long one.

The **overall** blended rate has no such problem and includes both billing models: at portfolio
level a fee *is* revenue and the hours behind it are known. The rate table's footer therefore shows
a blended rate but an em dash for an overall card rate — a mean of per-discipline means is a third
figure nobody asked for.

### 8. Partiality is stated, not inferred

Two tallies ride alongside every total, because both describe figures that are **absent rather than
zero** and neither is visible in the numbers:

- `unknownCostRoleCount` — roles with no derivable cost, excluded from the cost total. So the total
  is **partial rather than lower**.
- `projectsWithoutBillingType` — projects contributing `null` revenue, not 0.

They render in `ReportSection`'s existing `caption` slot as fine print rather than as a widget (a
coverage tile was considered and declined). Portfolio margin is likewise recomputed from summed
revenue and cost rather than summed from per-project margins: summing margins would treat a project
with known revenue and unknown cost as contributing *zero* margin, which is a stronger claim than
"we don't know".

`marginPercent` is null whenever revenue is 0 — the same rule as `marginOf`, so a portfolio with no
revenue reports "—" rather than a triumphant 100%.

### 9. `report-range.ts` promoted out of `lib/utilization`

The window parser moved to `src/lib/reporting/report-range.ts`, `UtilizationRange` became an alias
of `ReportRange`, and `parseUtilizationRange` became `parseReportRange` with a **`maxDays`
parameter**.

Two reports must agree on what "this quarter" means — a reader comparing revenue against capacity
over the same period should not have to check whether the pages round the window the same way. The
one thing they legitimately disagree about is how *wide* a window each can afford, which is why the
cap is a parameter: utilization keeps 366 days because its read is a day-by-day scan per person,
while finance allows `MAX_FINANCE_RANGE_DAYS = 1096` (~3 years) because its read is a bounded row
query.

`RANGE_PRESETS` was left untouched (`thisMonth`, `lastMonth`, `thisQuarter`, `thisYear`). Adding
`lastYear` — which a finance reader will want — would change the utilization filter bar too, so it
is a follow-up rather than a side effect.

## Consequences

- Portfolio revenue and margin exist for the first time, and cannot drift from a project's own
  panel: both run the same `computeProjectMargin`.
- A fixed fee now has a defensible per-period figure, and the shares partition — across time and
  across practices.
- Nothing new is disclosed: same capability, same class of fact, and *less* raw data on the wire
  than the project detail page sends.
- **Not built:** invoiced/actual revenue (needs the `time_entries → project_role` link), pipeline
  value (`opportunities` carries no deal amount), forecast-vs-actual as a workflow, a per-person
  capacity model, statutory holidays, and the declined widgets (confirmed-vs-tentative split,
  LOB/client breakdown tables, monthly trend chart, coverage tile).
- **The rate card remains the weak link.** Every figure on this page inherits
  `DEFAULT_BILL_RATE = 250`. Replacing the placeholder card is now more urgent than it was, because
  the numbers are aggregated and look authoritative.
