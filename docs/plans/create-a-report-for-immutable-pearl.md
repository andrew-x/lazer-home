# Finance report (`/reporting/finance`)

## Context

Revenue and margin exist today only **one project at a time** — `computeProjectMargin` runs on a single project's plan and renders in that project's budget panel, plus a precomputed margin column on the projects list. Nothing in the app answers a portfolio question: *what is the book worth this quarter, at what margin, at what blended rate.*

This adds the first portfolio-level commercial surface: revenue, margin, active projects, and blended rates, filterable by **line of business** and **date range**, displayable in **CAD or USD**. Two extra widgets were chosen: a portfolio **fixed-fee discount/premium** roll-up and **off-standard-rate exposure**.

### Two constraints that shape everything below

1. **There is no path from timesheets to revenue.** `time_entries.projectId` points at a *project*, never at a `project_role`, so hours are never priced. Every figure here is **plan-based** (`project_roles`: `billRate` × weekdays × `hoursPerDay`), not invoiced. The page must say so in its description — otherwise "revenue" reads as billed. This is also why the report does *not* get a `Planned | Logged` basis toggle like `/reporting/utilization`: there is no logged money series to toggle to.
2. **The rate card is a documented placeholder** — `DEFAULT_BILL_RATE = 250` USD with an empty `BILL_RATE_EXCEPTIONS`. Every role currently prices at $250/hr, so the report will be structurally correct and numerically fictional until real rates land. It also means "off-standard-rate exposure" reads as near-zero today; the widget is worth building anyway (it becomes meaningful the moment the card is populated) but don't treat a near-zero reading as a bug.

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Access | `{ projects: ["viewMargin"] }` — `finance`, `delivery-manager`, `manager`, `admin` | **No new capability, no matrix change.** These roles already see per-project margin; this aggregates the same disclosure. `permissions.ts` / `permissions.test.ts` / `docs/domains/permissions.md` are untouched. |
| Fixed fee, in-period | Prorated by billable hours: `fee × (role hours in window ÷ total role hours)` | Follows delivery shape, and contiguous windows sum back to exactly the whole fee. Needs an ADR — refines ADR 0066/0053 §5. |
| Average rate | Blended effective rate = revenue ÷ hours | What the portfolio actually earns per hour; for fixed fee it's the *realized* rate. |
| "Per role" | Per **discipline** (`ProjectRoleType`: Engineer / Designer / Architect / QA / Specialist / Delivery) | |

### Assumption to check at review — per-discipline blended rate

A blended rate needs revenue ÷ hours, but **fixed-fee revenue is not attributable to a role** (ADR 0066; `RoleMargin.revenue` is `null` there by design, deliberately, so a fee can never be mistaken for a sum of role shares). Apportioning the fee across disciplines to fill that column would break exactly the invariant the codebase protects.

So the per-discipline table ships **two** columns instead of one:

- **Card rate** — hours-weighted mean of stored `project_roles.billRate`. Defined for *every* counted role including fixed-fee ones (`RoleMargin.billRate` stays non-null there on purpose — a rate can't be summed into a fee).
- **Blended** — revenue ÷ hours, **T&M roles only**, `null` for a discipline whose hours are all fixed-fee, with the hours it covers shown beside it so the reader can see the coverage.

The **overall** blended rate is unaffected: at portfolio level the fee *is* revenue, so `total revenue ÷ total hours` is well defined and includes both billing models. Flag this at review if you'd rather apportion.

### Disclosure posture — deliberately unlike `/reporting/utilization`

Utilization ships one projection and filters it in-memory in the browser. That won't do here: a per-role `cost` figure divided by its hours *is* that person's hourly compensation, so filtering client-side would put every person's pay rate in the page HTML for the whole portfolio at once.

Instead follow the **projects-list** posture (`listMargin` in `getProjectsList.ts`): **both filters live in `searchParams`, all aggregation happens server-side, and both display currencies are precomputed.** Only aggregated money crosses to the client; no per-person hourly cost, no per-role cost. The currency toggle is client-only, picking between two precomputed branches. Filters round-trip — fine for a finance report, and it makes a filtered view linkable.

Payload fields cross to the client **enumerated one at a time, never spread** (ADR 0063 §5, no exceptions).

## Implementation

### 1. Promote the report range module

`src/lib/utilization/utilization-range.ts` is now needed by a second report. Move it:

- → `src/lib/reporting/report-range.ts`; test moves alongside.
- Define `export type ReportRange = { start: string; end: string }` here; `src/lib/utilization/utilization-report.ts` keeps `export type UtilizationRange = ReportRange` so its ~30 downstream references don't churn.
- Rename `parseUtilizationRange` → `parseReportRange`, and take `maxDays` as an option (default `MAX_RANGE_DAYS = 366`, preserving today's behaviour). Finance passes a wider cap — `MAX_FINANCE_RANGE_DAYS = 1096` (~3 years) — because its read is a role-span query, not utilization's day-by-day-per-person scan.
- Update importers: `reporting/utilization/page.tsx`, `src/components/utilization/utilization-filters.tsx`. `bun run check` catches any miss.
- **Leave `RANGE_PRESETS` exactly as-is** (`thisMonth`, `lastMonth`, `thisQuarter`, `thisYear`). Adding `lastYear` would change utilization's filter bar too — out of scope; note it as a follow-up.

If this move starts sprawling, fall back to importing `@/lib/utilization/utilization-range` directly from finance and drop the refactor — it isn't load-bearing for the feature.

### 2. Pure math — `src/lib/finance/finance-report.ts` (+ `.test.ts`)

No `db`, no React. **Reuses the one existing margin engine rather than adding a second** — the report and the project detail page must never disagree about a project's revenue.

The trick that avoids touching `computeProjectMargin` at all: **clip the role dates to the window and scale the fee, then call it again.**

```ts
export const FINANCE_REPORT_ACCESS: PermissionCheck = { projects: ["viewMargin"] };

/** Role with its span narrowed to the window; null when it doesn't overlap at all. */
export function clipRoleToWindow<T extends { startDate: string; endDate: string }>(
  role: T, window: ReportRange,
): T | null;

/** Σ clipped hours ÷ Σ total hours over counted roles. 0 when the denominator is 0. */
export function windowHoursShare(
  roles: readonly MarginRoleInput[], window: ReportRange,
): number;

/** Same fee scaled to its in-window share — how the proration is expressed. */
export function scaleFixedFee(billing: MarginBilling, share: number): MarginBilling;

export function computeProjectFinance(args): ProjectFinance;   // calls computeProjectMargin twice
export function buildFinanceReport(inputs: FinanceInputs): FinanceReport;
```

`computeProjectFinance` calls `computeProjectMargin` twice per project:

- **overall** — roles as stored, billing as stored.
- **inPeriod** — roles clipped to the window (non-overlapping ones dropped), billing = `scaleFixedFee(billing, share)`.

Because `computeProjectMargin` derives hours from `startDate`/`endDate` via `roleBillableHours` → `countWorkingDays`, clipping gives correct in-window hours, T&M revenue **and** cost for free — both sides clipped identically, so `marginPercent` stays coherent. Passing a scaled `budgetAmount` makes fixed-fee revenue prorate with **zero changes to `project-margin.ts`**, and leaves `hourlyValue` / `hourlyValueDelta` internally consistent in-window (clipped hourly value vs the scaled fee).

Note `inPeriod.countedRoleCount` becomes "roles active in the period" — a useful figure, worth labelling as such.

`FinanceReport` carries:

- `totals` — overall + inPeriod: revenue, cost, margin, marginPercent, hours. Aggregate with the module's existing `sumKnown` discipline: nulls contribute nothing, so a total is **partial rather than deflated**, and carry `projectsWithoutBillingType` / `unknownCostRoleCount` alongside so the partiality is stateable.
- `projects: ProjectFinance[]` — the active-projects table: name, client, LOBs, derived status, derived date span, then revenue/margin **overall** and **in period**.
- `rates` — overall blended rate + per-discipline rows (`hours`, `cardRate`, `blended`, `tmHours`).
- `fixedFee` — portfolio roll-up: Σ `revenue` and Σ `hourlyValue` over FIXED_FEE projects → delta and delta %. **Uncoloured** — a negotiation isn't a loss (ADR 0066).
- `offStandard` — hours and amount-at-role-rates on roles where `isOffStandardRate({ lineOfBusiness, roleType, billRate })` is true, as a share of the whole. Uses *hourly amount* (defined for both billing models) rather than revenue, so no fee gets apportioned.
- `convertedFrom` — union of each project's `convertedFrom`, for `FxRateNote`.

`isOffStandardRate` needs `lineOfBusiness`, which `MarginRoleInput` deliberately omits. Carry it on the finance-local role type and use it **only** for the derived marker — never feed the card back into the margin math (that's the retroactive-repricing bug ADR 0066 removed).

**Reuse, don't rewrite:** `computeProjectMargin`, `roleBillableHours`, `countsTowardBudget`, `marginTone`/`marginAmountTone`, `resolveDisplayCurrency` (`src/lib/projects/project-margin.ts`); `countWorkingDays` (`src/lib/staff/pto-working-days.ts`); `convert` (`src/lib/format/fx.ts`); `isOffStandardRate` (`src/lib/projects/bill-rates.ts`); `deriveProjectStatus` / `deriveProjectLinesOfBusiness` (`src/lib/projects/project-derived.ts`); `rangeOf` (`src/lib/projects/plan-summary.ts`).

**LOB filter semantics** (state in the module docstring): filtering by LOB keeps only *roles* in that LOB, then recomputes — LOB lives on the role, and a project can span several. A project with no remaining role drops out of the table. Consequence worth naming: a fixed fee is **not** split across a project's LOBs, so a LOB-filtered view prorates that project's fee by the filtered roles' hour share, exactly as the date window does.

### 3. Read — `src/actions/finance/getFinanceReport.ts`

`import "server-only"`, plain async fn, not a `'use server'` action — the `/reporting/*` convention.

```ts
export const financeFilterOptions = STAFF_FILTER_OPTIONS;   // so the page needn't import drizzle
export type FinanceReportData = {
  range: ReportRange;
  lineOfBusiness: LineOfBusiness | null;
  byCurrency: Record<DisplayCurrency, FinanceReport>;   // both precomputed server-side
  exchangeRates: ExchangeRates;
};
export async function getFinanceReport(args: {
  range: ReportRange; lineOfBusiness: LineOfBusiness | null;
}): Promise<FinanceReportData>;
```

- `requirePermission(user ?? { role: null }, FINANCE_REPORT_ACCESS)` first — defence in depth behind the route gate.
- Explicit column projection only, never `db.select().from(...)`. No N+1:
  1. Distinct `projectId`s having ≥1 non-cancelled role overlapping the window (`startDate <= end AND endDate >= start`).
  2. **All** roles for those projects — the *overall* columns need whole spans, which extend outside the window.
  3. `projects` + `companies.name` for those ids.
  4. `getProjectCostBasis({ staffIds, usdRates })` — reuse it; it *is* the single place the `viewMargin` decision is made, and returns `null` when denied. `includeCost = costBasis !== null` (always true here, given the page gate — but derive it, don't assume it).
  5. `getExchangeRates()`.
- Then `buildFinanceReport(...)` once per `DISPLAY_CURRENCIES` entry.
- Docstring states the gate decision and why (expected at review).

### 4. Page — `src/app/(app)/reporting/finance/page.tsx`

Standard report shape: `export const metadata = { title: "Finance" }`; `getCurrentUser()` then `if (!user || !userHasPermission(user, FINANCE_REPORT_ACCESS)) notFound()` (404, so the route can't be probed); `await searchParams`; `parseReportRange(...)` + parse the LOB param against `LINE_OF_BUSINESS`; `await getFinanceReport(...)`; render `max-w-7xl` heading block + one client component.

The description must name the basis and the windows — echoing the discipline ADR 0063 imposed on the home dashboard: *plan-based, from confirmed and tentative project roles; not invoiced.* Every figure labels which window it's on ("overall" vs the range).

Per `.claude/rules/nextjs.md`, confirm the `searchParams` convention against `node_modules/next/dist/docs/` rather than assuming — mirror `reporting/utilization/page.tsx`, which is known-good.

### 5. Client components — `src/components/finance/`

- `finance-report.tsx` — shell; holds only `displayCurrency` in `useState` (default **CAD**, matching `MARGIN_FLAG_CURRENCY` and the comp dashboards), picks `byCurrency[displayCurrency]`, renders `FxRateNote`.
- `finance-filters.tsx` — prev/next arrows + two `EndpointPicker`s + preset `ToggleGroup` + a `SelectFilter` for LOB, writing the URL via `router.replace`. Lift wholesale from `utilization-filters.tsx`.
- `finance-summary-cards.tsx` — `StatCard` grid: revenue, margin, margin %, hours — one row for the range, one for overall.
- `finance-projects-table.tsx` — active projects; `DataTable` with `defaultSorting` on in-period revenue and `SortHeader` columns.
- `finance-rates-table.tsx` — blended overall + per-discipline rows.
- `finance-pricing-cards.tsx` — fixed-fee roll-up + off-standard exposure.

Wrap each block in `ReportSection` from `src/components/utilization/report-primitives.tsx`. Since the coverage widget was declined, put the partiality facts in `ReportSection`'s existing `caption` slot as fine print — *"N roles have no cost basis; M projects have no billing type set, so revenue is partial"* — rather than letting a partial total read as a small one. Money via `aggregateMoneyFormatters(currency)`; percentages via `formatPercent`; `EmptyState` / `EmptyCell` for gaps; `null` renders `—`, never `0`.

No charting library — none of the chosen widgets needs one.

### 6. Nav — `src/components/app-shell/nav.ts`

Add a `NavSubItem` under `Reporting`: `{ title: "Finance", href: "/reporting/finance", permission: FINANCE_REPORT_ACCESS }`. **Leave `/reporting/page.tsx`'s redirect ladder alone** — inserting finance would silently move `manager`/`admin`'s landing page.

### 7. ADR + docs

New ADR at the next free number (**0068** at time of writing — verify against `docs/decisions/`) covering: prorating a fixed fee by hours and how that refines ADR 0066/0053 §5; gating on `viewMargin` with no matrix change; server-side aggregation + both currencies precomputed instead of utilization's in-memory filtering, and why; the per-discipline blended-vs-card-rate split; and that the whole report is plan-based with no logged basis.

Then **dispatch the `librarian` subagent** with a summary — it owns `/docs` (likely a new `docs/domains/finance.md` plus `docs/README.md`).

## Verification

**Static (this is the evidence — I never run the app):**

- `bun run check` — Biome + `tsc --noEmit` + `bun test`.
- `bun run build` — non-trivial change, so required.
- `/audit-rbac` (confirm no gate was weakened and the matrix is untouched) and `/code-review`.

**New tests — `src/lib/finance/finance-report.test.ts`.** Per ADR 0037 don't reflexively re-add tests; these are the invariants types can't express, each of which would otherwise produce a plausible-looking wrong number:

1. **Proration partitions the fee.** In-period revenue summed over contiguous windows covering a fixed-fee project equals the whole fee exactly. This is the defining property of the chosen definition.
2. A role wholly outside the window contributes 0 in-period hours and revenue, but its full hours to *overall*.
3. T&M in-period revenue = rate × weekdays-in-overlap × `hoursPerDay`, hand-checked against a real calendar month (follow the existing `// Mon 2026-08-03 → Fri 2026-08-14: exactly 10 weekdays` style).
4. A project with no billing type contributes `null`, is counted in `projectsWithoutBillingType`, and leaves the portfolio total **partial rather than deflated**.
5. A role with no cost basis makes margin partial, not smaller; `marginPercent` is `null` when revenue is 0 — never `NaN`, never a triumphant 100%.
6. Blended rate over zero hours is `null`, not `NaN`/`Infinity`.
7. Per-discipline `blended` is `null` for a discipline whose hours are all fixed-fee, while `cardRate` is present — pins the ADR 0066 boundary.
8. **CAD and USD branches differ by exactly the rate, but `marginPercent` is identical in both** — a percentage must not move when the display currency does. Use round rates so figures are hand-checkable, as `project-margin.test.ts` does.
9. Filtering by LOB drops projects with no remaining role, and reprorates that project's fee to the filtered roles' hour share.

**Runtime checks to hand back to you** (please run and paste):

- `/reporting/finance` renders; toggling CAD/USD changes amounts but not percentages.
- A `user`-role account gets a 404 and sees no Finance nav item.
- Range + LOB survive a reload and a copy-pasted URL.
- Spot-check one project's *overall* revenue/margin against that project's own budget panel — they must agree to the dollar.
- View-source the page and confirm no per-person hourly cost or per-role cost appears in the payload.

## Out of scope

Actuals/invoiced revenue (needs a `time_entries → project_role` link), forecast-vs-actual as a workflow, pipeline value (`opportunities` carries no deal amount), a real per-person capacity model, statutory holidays, and the declined widgets (confirmed-vs-tentative split, LOB/client breakdown tables, monthly trend chart, coverage tile).
