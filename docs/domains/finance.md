# Domain: Finance (reporting)

**Status: built.** A read-only report at **`/reporting/finance`**, gated on
**`projects.viewMargin`**. Like [utilization.md](./utilization.md) it is **not a new domain in the
data-model sense** — no table, no migration, no capability, no permission-matrix change. It is the
first surface that answers a **portfolio** money question: *what is the book worth this window, at
what margin, at what blended rate.*

[**ADR 0068**](../decisions/0068-finance-report-fee-proration-and-server-side-aggregation.md) is
the authoritative rationale — every rule below is stated there with its rejected alternatives.
Don't restate it here; read it before changing any definition.

> **The module docstrings in `src/lib/finance/finance-report.ts` and
> `src/actions/finance/getFinanceReport.ts` are the authoritative statement of the definitions and
> the gate.** This doc summarises the shape and the traps; if the two disagree, the code wins.

## The one thing to internalise: everything is plan, nothing is invoiced

`time_entries.projectId` points at a **project**, never at a `project_role`. An hour is therefore
never attached to the rate it would bill at, so **nothing in this app can price time actually
worked.** Every figure on this page is `billRate × Mon–Fri weekdays in the role's span ×
hoursPerDay`, read off `project_roles`.

Consequences that shape the whole surface:

- **There is no `Planned | Logged` basis toggle**, unlike the utilization report — there is no
  logged-money series to toggle *to*. An `InlineNotice` on the page says so in words, and the page
  description reads "Committed billings, not invoices".
- This is **not** a UI gap to close later. It needs a **`time_entries → project_role` link** first.
  Until then "revenue" means *what the plan is committed to bill*.
- **Every figure inherits the placeholder rate card.** `DEFAULT_BILL_RATE = 250` with an empty
  `BILL_RATE_EXCEPTIONS` (see [projects.md](./projects.md#budget--margin)) makes the report
  structurally correct and numerically fictional, and makes the off-standard-rate figure read
  ~0%. That is the card being uniform, not the measure being broken.

## Two time bases, and they are never added

| Basis | What it is |
|---|---|
| **In period** | the plan **clipped** to the window, with a fixed fee **prorated** into it |
| **Overall** | the **whole plan** of every project active in that window, however far its dates run either side — the *same projects*, measured end to end |

Each names its own window in its `ReportSection` description, the discipline
[ADR 0063](../decisions/0063-home-dashboard-two-time-bases-and-point-in-time-staffing.md) imposed on
the home dashboard. A reader who mixed them would conclude the portfolio had shrunk. The projects
table's footer totals the **in-period columns only** — summing "overall" over a window is not a
quantity that belongs to that window.

## Fee proration — the one piece of arithmetic this module owns

In-period fixed-fee revenue is `fee × (billable hours in the window ÷ billable hours of the whole
plan)` (`feeRecognitionShare`). The defining property, pinned by test:

> **Contiguous windows partition the fee exactly.** Twelve months of a one-year engagement sum back
> to the whole fee — no more, no less.

This **refines**, and does not relax,
[ADR 0066](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md): a
fee is now attributable to **time** (a basis every role on the plan shares); it is still **never**
attributable to a **role**. Rejected: straight-line by calendar days (recognizes revenue in months
with almost no staffing) and excluding fees from the in-period column (understates the portfolio
without saying by how much).

⚠️ **The denominator is always the whole plan, never the slice.** This was a real bug caught in
testing: dividing by the filtered roles' own hours made every share `1`, so filtering a
multi-practice fixed-fee project to one line of business reported the **entire fee** against that
practice — and the five per-practice views each claimed all of it. With the whole plan underneath,
the shares partition across time *and* across practices, and a filter combined with a window
multiplies out correctly.

**Both time bases are sliced this way**, not just the in-period one — a practice view whose
"overall" column showed the whole fee beside its own prorated half invites exactly the wrong
subtraction. Unfiltered, the practice share is exactly `1` and "overall" is the untouched plan, so
**an unfiltered project row agrees to the dollar with that project's own budget panel** — the
cross-check a reader is most likely to perform.

## One margin engine, called twice

The report **does not reimplement revenue or cost.** It clips each role's dates to the window
(`clipRoleToWindow`), scales the fee by the share (`scaleFixedFee`), and calls the existing
**`computeProjectMargin`** again — **zero changes to `src/lib/projects/project-margin.ts`.**

- **overall** — roles as stored, fee scaled by the practice share.
- **inPeriod** — roles clipped to the window, fee scaled by practice × window share.

Because `computeProjectMargin` derives hours from `startDate`/`endDate`, the clip yields in-window
hours, T&M revenue **and** cost for free, with revenue and cost clipped *identically* — so the
margin percentage stays coherent instead of dividing a whole-span cost by a partial revenue. This is
also *why* proration is expressed as a **scaled fee** rather than a post-hoc multiplication: a
report that computed its own revenue would eventually disagree with the project it aggregates.

Two side effects to know:

- **`inPeriod.countedRoleCount` means "roles active in the period."** A role that doesn't overlap
  the window is **dropped**, not clipped to zero — an inclusive date pair cannot express "no days",
  so `clipRoleToWindow` returns `null`.
- **A project whose in-window roles all belong to another practice drops out entirely** under a
  line-of-business filter (`inPeriod.countedRoleCount === 0`), rather than padding the table with a
  zero row. The LOB filter keeps matching **roles** (line of business lives on the role, not the
  project — [ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md)), and a
  project left with none is not "a project with zero revenue in this practice"; it isn't in the
  practice at all.

## Which roles count — `countsTowardBudget`, so **tentative counts**

The report counts **everything except `cancelled`** — it reuses `countsTowardBudget` from the
margin math, so `tentative` **and** `paused` roles carry revenue, cost and hours. The page
description says so out loud ("from confirmed and tentative project roles").

> ⚠️ **This deliberately disagrees with the utilization report**, which is `confirmed`-only
> ([ADR 0064](../decisions/0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md) §2).
> The two are asking different questions — *what have we committed to bill* vs *who did we actually
> staff* — and the same window can legitimately show different hours on the two pages. Don't
> "reconcile" them. (The allocations capacity meter also counts tentative, so finance and the meter
> agree where finance and utilization don't.)

**PTO is ignored** too, as in the margin math: a salaried person's cost accrues on leave, so netting
leave off hours would move revenue without moving cost.

## The blocks, in render order

All wrapped in the shared **`ReportSection`** from `src/components/utilization/report-primitives`
(finance reuses the utilization report's primitive — see *Gotchas*).

1. **Filters** (`finance-filters.tsx`) — date range (◀ ▶ `shiftRange` + two `EndpointPicker`s + the
   four presets) · line of business · **currency**, in one bordered panel.
2. **The plan-basis `InlineNotice`** + `FxRateNote` (`convertedFrom`, stated once per page naming
   the rates — [ADR 0053](../decisions/0053-project-budgets-and-margin.md) §8).
3. **In period** and **Overall** — five `StatCard`s each: Revenue · Margin · Cost · Blended rate ·
   Billable hours. `marginHint` distinguishes the three absent cases ("Cost withheld" / "No revenue
   or cost basis" / "No revenue to compare against") because collapsing them into one "—" leaves a
   reader unable to tell a withheld figure from an unpriced portfolio.
4. **Active projects** (`finance-projects-table.tsx`) — one row per project, ordered by **in-period
   revenue descending** with unpriced (no billing type) projects **last** and name as the tiebreak.
   In-period columns first (Hours · Revenue · Margin · Margin %), the overall pair muted to their
   right. A fixed fee's in-period share is printed under the billing type ("38% of fee in period").
   Margin *amounts* are toned by **`marginAmountTone`** — the same helper the project budget panel
   uses, rounded to whole dollars first so "CA$0" is never red.
5. **Average rates** (`finance-rates-table.tsx`) — **two rate columns per discipline, and the
   difference is load-bearing**:
   - **Card rate** — the **hours-weighted** mean of the roles' own stored `billRate`. Defined for
     *every* counted role, fixed-fee included (`RoleMargin.billRate` is deliberately non-null
     there: a *rate* can't be mistaken for a share of a fee the way an *amount* can). Hours-weighted
     over a plain mean, or a two-week role moves the figure as much as a year-long one.
   - **Blended** — revenue ÷ hours, over **time-and-materials roles only**. `null` for a discipline
     whose in-window hours are all fixed-fee, with the T&M hours it *does* cover shown beside it and
     an `InlineNotice` explaining why when any discipline is in that state. Filling it would require
     apportioning a fee across the disciplines that delivered it — the invented number ADR 0066
     forbids. **This column is the ADR 0066 boundary made visible.**
   - The footer shows an **overall blended rate but an em dash for an overall card rate**: at
     portfolio level a fee *is* revenue and the hours behind it are known, whereas a mean of
     per-discipline means is a third figure nobody asked for.
6. **Pricing** (`finance-pricing-cards.tsx`) — four tiles, **none of them coloured**:
   - the **fixed-fee roll-up** (`FixedFeeRollup`): recognized fee vs. the same roles priced hourly,
     as a signed delta and percent — the project-level `hourlyValue` comparator (ADR 0066) summed
     over the portfolio. Revenue-side only, so it needs no cost basis. A fee below role rates is a
     **commercial decision, not a loss**, which is why nothing is tinted.
   - **off-standard-rate exposure** (`OffStandardExposure`): measured in **hours** and in **amount
     at role rates** (rate × hours), *never* in revenue — otherwise this metric becomes a back door
     to the per-role fee apportionment the rest of the module refuses. `isOffStandardRate`
     deliberately conflates "negotiated" with "the card moved"; the caption names
     `BILL_RATES_REVIEWED_ON`.

## Partiality is stated, not inferred

Two tallies ride alongside every total, rendered in `ReportSection`'s existing **`caption`** slot as
fine print (a coverage tile was considered and declined):

- **`unknownCostRoleCount`** — roles with no derivable cost, excluded from the cost total, so it is
  **partial rather than lower**.
- **`projectsWithoutBillingType`** — projects contributing `null` revenue, not `0`.

Portfolio margin is **recomputed from summed revenue and cost**, never summed from per-project
margins: summing margins would treat a project with known revenue and unknown cost as contributing
*zero* margin, a stronger claim than "we don't know". `marginPercent` is `null` whenever revenue is
0 — the same rule as `marginOf`, so a portfolio with no revenue reports "—" rather than a triumphant
100%.

**The em dash is load-bearing**, as in `utilization-format.ts`: in `finance-format.ts` `null` means
"there is no basis for this figure", never zero. A genuine zero prints "0".

## Access control

**Gated on `projects.viewMargin`, via the named constant `FINANCE_REPORT_ACCESS = { projects:
["viewMargin"] }`** declared beside the math in `src/lib/finance/finance-report.ts` — the pattern
`PROFILE_COMPLETENESS_ACCESS` and `BONUS_PAYMENT_READ_ACCESS` established, so the route, the nav
item and the read all resolve **one** constant. Holders: `finance`, `delivery-manager`, `manager`,
`admin`. See [permissions.md](./permissions.md#reusing-a-capability-for-a-new-surface--named-gate-constants).

- **No new capability and no matrix change.** These roles already read a project's cost and margin
  on its own detail page and the margin column on `/projects`; this **re-aggregates the same
  compensation-derived disclosure** rather than exposing a new *kind* of fact. `permissions.ts`,
  `permissions.test.ts` and [permissions.md](./permissions.md) are untouched.
- **Revenue alone wouldn't need the gate.** It is gated anyway because the page's whole point is
  revenue **and** margin side by side; a revenue-only variant would be a different report, and
  splitting the surface in two to dodge one capability check would double the number of places a
  portfolio total is computed.
- **The route `notFound()`s** (not an error — the route shouldn't be probeable) and
  **`getFinanceReport` `requirePermission`s and *throws***, as defence in depth for a direct call.
  It throws rather than masking, unlike `getProjectCostBasis` which withholds cost so the rest of a
  project page still renders: here there is no useful remainder.
- **Cost inputs still come from `getProjectCostBasis`**, which re-derives the same decision.
  Inlining its `staff_employment` projection to skip a redundant check would be the beginning of a
  second answer to "may this viewer see cost". `includeCost` is derived from `costBasis !== null`,
  not assumed from the gate.
- **Nav:** a `permission: FINANCE_REPORT_ACCESS` child under the ungated **Reporting** parent,
  placed before Compensation. The **`/reporting` redirect ladder was deliberately not changed** —
  it already falls through to the ungated `/reporting/utilization`, so nothing can fall past it and
  a gated destination would never be reached anyway.

## Server-side aggregation — the deliberate departure from the utilization report

ADR 0062/0064 ship **one projection** and filter it **in the browser**. That is safe there because
the projection carries nothing sensitive. Here it is not: **a role's cost divided by its hours *is*
that person's hourly compensation**, so a client-side filter would put every assignee's pay rate in
the page HTML for the whole portfolio at once.

So finance follows the **projects-list** posture (`listMargin` in `getProjectsList`,
[ADR 0057](../decisions/0057-projects-list-margin-and-derived-flags.md)):

| Control | Where it lives | Why |
|---|---|---|
| **Date range** (`?start=&end=`) | **URL** | bounds which projects are read |
| **Line of business** (`?lob=`) | **URL** | changes which roles are counted, and therefore **how a fee prorates** — so it has to be applied where the aggregation happens |
| **Currency** (CAD default) | **client state** | both currencies are **already computed and shipped**; the toggle picks between two finished aggregates and discloses nothing new |

`buildFinanceReport` runs on the server **once per `DISPLAY_CURRENCIES` entry**, and only finished
aggregates cross to the client — no per-role cost, no per-person hourly cost. Filters round-tripping
is a feature here: a finance figure usually needs to be linkable.

Every URL write goes through one `navigate()` helper in `finance-filters.tsx`, so the range and the
practice can never clobber one another.

## The window — `src/lib/reporting/report-range.ts`

The window parser was **promoted out of `lib/utilization/`** (ADR 0068 §9) so both reports agree on
what "this quarter" means — a reader comparing revenue against capacity over the same period
shouldn't have to check whether the two pages round the window the same way.

- `utilization-range.ts` → **`src/lib/reporting/report-range.ts`**; `parseUtilizationRange` →
  **`parseReportRange`**; new **`ReportRange`** type, with `UtilizationRange` in
  `utilization-report.ts` now an **alias** of it (kept under that name because it reads better at
  ~30 call sites there).
- `parseReportRange(start, end, today?, maxDays?)` takes a **`maxDays`** 4th parameter, defaulting
  to `MAX_RANGE_DAYS = 366`. Finance passes **`MAX_FINANCE_RANGE_DAYS = 1096`** (~3 years) because
  its read is a bounded row query, not utilization's day-by-day-per-person scan — the cap exists to
  bound server work, so each report sets it from what its own read costs.
- Everything else is unchanged and shared: period-to-date presets, `shiftRange`'s whole-period
  stepping, the degrade-don't-error parsing, server-resolved `today`. **`RANGE_PRESETS` was left
  alone** — adding `lastYear` (which a finance reader will want) would change the utilization filter
  bar too, so it is a follow-up rather than a side effect.

## Gotchas

- **`FinanceRoleInput = MarginRoleInput & { lineOfBusiness }`.** That extra field is carried for
  **filtering and the off-standard marker only**, and must **never** be routed back into the margin
  math — pricing a stored plan from today's card is the retroactive repricing ADR 0066 removed.
  `MarginRoleInput`'s lack of `lineOfBusiness` is the invariant that enforces it.
- **`buildDisciplineRates` and `buildOffStandardExposure` walk the raw inputs again**, reapplying
  the clip and the LOB filter identically, because a `RoleMargin` carries no `roleType`. If you
  change the clip or the filter, change it in **three** places or the hours stop reconciling with
  `inPeriod.hours`.
- **Finance components import `ReportSection` from `src/components/utilization/report-primitives`.**
  A one-way dependency from the newer report onto the older one's primitive. If a third report
  appears, promote `report-primitives` to `src/components/reporting/` the way `report-range.ts` was
  promoted — don't fork it.
- **`financeFilterOptions = STAFF_FILTER_OPTIONS`** (re-exported so the page needn't import the
  schema), but only its **`lineOfBusiness`** tuple is used. The `role` there is a *person's*
  discipline; the rates table groups by **`project_roles.roleType`**, which is a different enum.
- **The read is three queries regardless of portfolio size**, plus the shared cost/FX reads: a
  `selectDistinct` overlap predicate (excluding `cancelled` in SQL, so a project made only of
  cancelled work is never fetched) finds *which* projects were active, then two concurrent queries
  pull the projects and **every** role on them — because "overall" is the whole engagement and most
  of it usually sits outside the window.

## Code map

- **Read:** `src/actions/finance/getFinanceReport.ts` (`import "server-only"`) —
  `getFinanceReport({ range, lineOfBusiness })` → `FinanceReportData { range, lineOfBusiness,
  byCurrency: Record<DisplayCurrency, FinanceReport>, exchangeRates }`. Owns the
  `requirePermission(FINANCE_REPORT_ACCESS)` throw, the three queries + `getProjectCostBasis` +
  `getExchangeRates`, and the **per-currency loop** over `buildFinanceReport`. Re-exports
  `financeFilterOptions = STAFF_FILTER_OPTIONS`. Unlike the utilization read this is **not merely a
  projection** — the aggregation happens here, on purpose (see *Server-side aggregation*).
- **Math:** `src/lib/finance/finance-report.ts` — pure, client-importable, no `db`/React.
  Exports the gate constant **`FINANCE_REPORT_ACCESS`**, **`MAX_FINANCE_RANGE_DAYS = 1096`**, the
  four pure primitives **`clipRoleToWindow` / `feeRecognitionShare` / `scaleFixedFee` /
  `computeProjectFinance`**, the entry point **`buildFinanceReport`**, and the types
  `FinanceRoleInput` · `FinanceProjectInput` · `FinanceInputs` · `ProjectFinance` · `FinanceTotals`
  · `DisciplineRate` · `FixedFeeRollup` · `OffStandardExposure` · `FinanceReport`. Private helpers
  `sumKnown` / `sumTotals` / `buildDisciplineRates` / `buildFixedFeeRollup` /
  `buildOffStandardExposure`.
  `finance-report.test.ts` (**28 tests**) is a sanctioned
  [ADR 0037](../decisions/0037-unit-tests-removed-except-rbac-matrix.md) carve-out — it pins the
  fee-partition property, the whole-plan denominator (the bug in *Fee proration*), the
  `null`-not-`0` partiality rules, the T&M-only blended column and the LOB-slice behaviour, none of
  which a type states.
- **Format:** `src/lib/finance/finance-format.ts` — `formatRate` (whole units + "/h") ·
  `formatMoneyDelta` · `formatPercentDelta` (both signed, U+2212 minus) · `formatHours` ·
  `formatCount`, plus `formatPercent` re-exported from `@/lib/format/format` for one import. Kept
  apart from the math so the math stays free of presentation; **the em dash convention is the
  point**.
- **Window (shared):** `src/lib/reporting/report-range.ts` (+ `.test.ts`, **23 tests**) — see
  *The window* above. Consumed by **both** reports.
- **UI:** `src/app/(app)/reporting/finance/page.tsx` (server; `max-w-7xl`, the `notFound()` gate,
  `parseReportRange(..., MAX_FINANCE_RANGE_DAYS)`, a private `parseLineOfBusiness` that degrades an
  unknown value to "no filter", server-resolved `today`) → `src/components/finance/`:
  - `finance-report.tsx` — the client shell. Holds **exactly one** piece of state (display currency)
    and indexes `data.byCurrency[currency]`. **Recomputes nothing.**
  - `finance-filters.tsx` — the control bar; exports **`LINE_OF_BUSINESS_PARAM = "lob"`**.
  - `finance-summary-cards.tsx` — the *In period* / *Overall* bands + `marginHint` +
    `partialityCaption`.
  - `finance-projects-table.tsx` · `finance-rates-table.tsx` · `finance-pricing-cards.tsx`.
- **Nav:** `src/components/app-shell/nav.ts` — a `permission: FINANCE_REPORT_ACCESS` child under
  Reporting, before Compensation.
- **Unchanged on purpose:** `src/lib/projects/project-margin.ts`, `src/lib/auth/permissions.ts` (+
  its test), the `/reporting` redirect ladder, `RANGE_PRESETS`, the schema and `scripts/seed/`.

## Known limits

- **Plan only, never invoiced or logged** — see the top of this doc. The named next step is a
  `time_entries → project_role` link.
- **`project_roles` is mutable with no history**
  ([ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md)), so a **past** window
  reflects the plan **as it stands now**. Re-running last quarter after a re-plan gives a different
  answer.
- **No holiday calendar, no part-time hours model** — hours are `Mon–Fri × hoursPerDay`, the same
  slight overstatement the margin math has, symmetric on revenue and cost.
- **The rate card is a placeholder.** Replacing `DEFAULT_BILL_RATE` is now more urgent than it was,
  because these numbers are aggregated and look authoritative.
- **Not built, deliberately:** invoiced/actual revenue, **pipeline value** (`opportunities` carries
  no deal amount), forecast-vs-actual as a *workflow* (this measures the gap; nothing re-forecasts
  or writes back), CSV export, and the declined widgets — a confirmed-vs-tentative split, LOB/client
  breakdown tables, a monthly trend chart, a coverage tile.

## Connects to

- **[Projects](./projects.md)** — this is the **portfolio view of the commercial layer**
  ([Budget & margin](./projects.md#budget--margin)). Same `computeProjectMargin`, same
  `projects.viewMargin` gate, same `marginAmountTone`, same `FxRateNote` convention. It is the
  **third and widest** margin surface after the project/opportunity plan panels and the `/projects`
  list column.
- **[Utilization](./utilization.md)** — the sibling report, sharing `report-range.ts`,
  `EndpointPicker`, `ReportSection` and `StatCard`, but deliberately differing on **three** axes:
  role statuses counted (all-but-cancelled vs. `confirmed`), where filtering happens (server vs.
  client), and the gate (`projects.viewMargin` vs. an open page). Finance has **no per-row
  pagination or in-table search** — the projects table is one row per active project, which is a
  short list.
- **[Timesheets](./timesheets.md)** — the missing half. No timesheet row is read at all.
- **[Permissions](./permissions.md)** — `FINANCE_REPORT_ACCESS` as the fourth named gate constant
  over an existing capability.
- **[CRM](./crm.md)** — each project row links to its `companies` parent; line of business comes
  from the role, and `opportunities` has no deal amount, which is why there is no pipeline figure.
