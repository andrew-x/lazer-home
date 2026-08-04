# Pipeline on the home dashboard

## Context

`/` today answers two questions: how *you* are doing (Your Status, year-to-date from submitted
timesheets) and how the *bench* is doing (Lazer Status, point-in-time from the `project_roles`
plan). Neither says anything about whether work is **coming in**. A staffed bench with an empty
pipeline and an idle bench with a full one look identical on the page.

This adds the sales picture to both bands:

- **Lazer Status** — open deals folded into three funnel bands (Top = Lead + Qualifying, Mid =
  Scoping + Allocating, Bottom = Negotiating + Closing) with per-stage counts; aggregate plan value
  for Mid and Bottom split fixed-fee vs T&M; and closed-won / closed-lost counts for this week and
  this month.
- **Your Status** — the deals *you own* (via `opportunity_owners`), per stage, with their plan value
  and their open tasks as next steps; plus your own closed-won / closed-lost for week and month.

Decisions taken up front (see *Decisions* below): `maturing` is omitted everywhere; deal size is the
linked project's plan revenue via the existing `computeProjectMargin`; nothing is newly gated; and
the close timing needs a **new `opportunities.closedAt` column** — it is not derivable today.

---

## Decisions and constraints

1. **`closedAt` is required.** `opportunities` has `createdAt`/`updatedAt` and nothing else; there is
   no status history anywhere (entries are manual notes, nothing auto-logs a transition). `updatedAt`
   is an unsound proxy — nudging a card inside the Won column, or renaming a deal won last year,
   would move it into this week. So: a dedicated nullable `closedAt`, not a general
   `statusChangedAt`.
2. **Deal size = the linked project's plan revenue**, computed with the existing pure
   `computeProjectMargin` (`src/lib/projects/project-margin.ts`) called with `includeCost: false` and
   `openRoleCostUsd: {}`. FIXED_FEE → `budgetAmount` converted; T&M → Σ(`billRate` × billable hours).
   **No compensation is read**, `staff_employment` is never queried, `getProjectsMarginContext` is
   deliberately not called. Rates arrive snapshotted on the role rows — never re-read the rate card
   in the math (ADR 0066 §8).
3. **No permission change.** Read parity with `getOpportunitiesPage`/`getOpportunitiesBoard` (ungated)
   and ADR 0066 §9 (revenue ungated, only cost/margin behind `projects.viewMargin`). `permissions.ts`,
   `permissions.test.ts` and `docs/domains/permissions.md` are untouched — **state this in both read
   headers** so `/audit-rbac` doesn't read the omission as an oversight.
4. **`maturing` omitted from both blocks**, structurally (see the module-load assertion in §4b).
   Both blocks caption *"Excludes Maturing"* — the bands deliberately won't sum to the board's open
   cards.
5. **Personal read takes no id** — subject resolved from the session via `getCurrentStaffId()`, the
   `getMyTasks` pattern. Own-data-only by construction: no cross-user id, so no gate to get wrong.

### Three facts that shape the code

- **There are three status writers, not two.** `createOpportunity` inserts an arbitrary status and
  only blocks `requiresProject(status)` — and `requiresProject("closed_lost")` is `false`, so a deal
  can be **created** as `closed_lost`. It must set `closedAt` too.
- **A T&M plan with no counted roles sums to a confident `0`, not `null`** (`sumKnown([]) === 0`). An
  unbuilt or entirely-cancelled plan must be classed **unpriced**, mirroring `listMargin`'s
  `countedRoleCount === 0` guard — otherwise a band reads "CA$0 of T&M work", which is a lie.
- **"This week" is not inside "this month."** Monday-start means `currentWeekStart()` can precede
  `currentMonthStart()`. The two closed figures are **not nested**, the SQL lower bound is
  `min(weekStart, monthStart)`, and the labels must state dates rather than the bare words.

---

## 1. Schema, migration, seed

### `src/lib/db/opportunities-schema.ts`

Add one column immediately after `status`:

```ts
closedAt: timestamp(),
```

Docstring: the instant this deal was **decided**. Set on the transition *into* `closed_won`/
`closed_lost`, back to NULL when it leaves one. Deliberately not a general `statusChangedAt` —
`updatedAt` already approximates "anything changed", and the home dashboard's question can only be
answered by a close-specific column. Maintained by exactly three writers through `closedAtFor`.

Plus, in the same `(t) => [...]` array — following the `projects_budget_shape` precedent:

```ts
check(
  "opportunities_closed_at_shape",
  sql`(${t.status} in ('closed_won','closed_lost')) = (${t.closedAt} is not null)`,
),
index("opportunities_status_closed_at_idx").on(t.status, t.closedAt),
```

Both sides are total (`status` is `notNull`), so no three-valued-logic hole. The CHECK is what stops a
fourth writer forgetting. Comment that the two enum literals are duplicated into SQL, with
`CLOSED_OPPORTUNITY_STATUSES` as the source of truth. The index serves `status IN (…) AND closed_at >= …`
in leading-column order over the one region of this table that grows forever.

### Migration

`bun run db:generate`, then **hand-edit** the emitted `0027_*.sql` (latest is `0026_wide_marten_broadcloak.sql`;
precedent for hand-editing is `0025_empty_frank_castle.sql`; see `docs/development.md` §Schema workflow).
The backfill is the hand-add and **must sit between `ADD COLUMN` and `ADD CONSTRAINT`** or the constraint
rejects every existing closed row. Never regenerate it afterwards.

```sql
--> The backfill below is HAND-ADDED and must run between the ADD COLUMN and the CHECK.
--> It is a ONE-TIME APPROXIMATION, not policy: rows closed before this column existed have
--> no recorded close instant, so they take `updated_at` — the last time the row was touched,
--> which for a decided deal is usually, never provably, the close. Not `created_at` (that
--> files every historical win in the week its deal was opened) and not left NULL (the CHECK
--> requires a value, and NULL would make "won this month" silently undercount rather than
--> visibly approximate). Accepted consequence: for ~a month, a few long-closed deals whose
--> rows happen to have been touched recently appear in the closed-this-week/month figures.
--> Do not re-run or "correct" this — from here the column is maintained by `closedAtFor`.
ALTER TABLE "opportunities" ADD COLUMN "closed_at" timestamp;--> statement-breakpoint
UPDATE "opportunities" SET "closed_at" = "updated_at"
  WHERE "status" IN ('closed_won', 'closed_lost');--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_closed_at_shape"
  CHECK (("opportunities"."status" in ('closed_won','closed_lost')) = ("opportunities"."closed_at" is not null));--> statement-breakpoint
CREATE INDEX "opportunities_status_closed_at_idx" ON "opportunities" USING btree ("status","closed_at");
```

### Seed — two files

**`scripts/seed/sales.ts`** (insert shape at ~L69–79): add `closedAt`, derived so the CHECK holds by
construction — `null` for open statuses; for closed ones a spread so **both** windows have data:
~4 rows per status inside `faker.date.between({ from: <this Monday>, to: now })`, ~6 between the
1st of the month and this Monday, the rest anywhere in the 180-day window. Use
`parseIsoDate(currentWeekStart())` / `parseIsoDate(currentMonthStart())` from
`src/lib/timesheets/timesheet-week.ts` so seed and app agree on the week boundary; clamp
`createdAt ≤ closedAt ≤ updatedAt`. Add one **forced fixture**: a `closed_won` at exactly `weekStart`,
so the straddle case exists in real data, not only in a test.

**`scripts/seed/projects.ts`**: today only `closed_won` opportunities get a `projectId` (~L88/L125–133),
which (a) violates ADR 0024's `requiresProject` invariant for the seeded allocating/negotiating/closing
deals and (b) makes every Mid/Bottom value figure read 100% unpriced locally. Link a handful of open
Mid/Bottom deals to projects — one per `allocating_*`, `negotiating`, `closing_*`, plus 2 `scoping` —
and point **two of them at the same project** so the per-band dedupe is visible in the running app.
Comment all three reasons.

---

## 2. The three status writers + a shared pure helper

New `src/lib/crm/opportunity-close.ts` (+ `.test.ts`), mirroring `src/lib/crm/task-completion.ts` —
three call sites, a four-way transition table, and a DB CHECK that turns an omission into a 500.

```ts
/** Terminal status? Derived from CLOSED_OPPORTUNITY_STATUSES, never re-listed. */
export function isClosedStatus(status: OpportunityStatus): boolean;

/**
 * The `closedAt` a status write must persist — an EXPLICIT value in every case, never
 * `undefined`, so a caller cannot accidentally leave the column untouched.
 *   open   → closed  : `now`       (decided just now)
 *   closed → closed  : `previous`  (won→lost is a correction of an existing decision; and
 *                                   re-saving or re-dragging a won deal must not move it
 *                                   into this week — the whole reason this isn't updatedAt)
 *   closed → open    : `null`      (reopened)
 *   open   → open    : `null`
 */
export function closedAtFor(
  prevStatus: OpportunityStatus | null,   // null = insert
  nextStatus: OpportunityStatus,
  now: Date,
  previous: Date | null = null,
): Date | null;
```

`now` is passed in, not read inside — same discipline as server-stamped `nowMs` for `MyTasksPanel`.

Call sites (no extra queries anywhere):

- **`src/actions/crm/updateOpportunityField.ts`**, case `"status"` (~L69–86): the transaction already
  selects `{ status }` — widen to `{ status, closedAt }`, then
  `setOpportunity(tx, { status: nextStatus, closedAt: closedAtFor(before.status, nextStatus, new Date(), before.closedAt) })`.
- **`src/actions/crm/updateOpportunityPosition.ts`** (~L35–58): identical; add `closedAt` to the
  existing `.set({ status, position })`.
- **`src/actions/crm/createOpportunity.ts`**: `closedAt: closedAtFor(null, parsedInput.status, new Date())`.
  One-line comment that this is reachable only for `closed_lost`, so nobody deletes it as dead code.

Nothing else writes `opportunities.status` — verify with a grep for `update(opportunities)` /
`insert(opportunities)`. `confirmRolesOnWon` is unchanged; `closedAtFor` deliberately does not fold
into it (one writes roles, the other computes a column).

---

## 3. New reads

### 3a. `src/actions/projects/getPlanRevenueByProject.ts`

Lives in the **projects** domain so neither CRM read owns project SQL. Imitates
`getProjectsList.ts`'s `assembleRows` (~L297) / private `listMargin` (~L482) minus the cost half.

```ts
export type PlanRevenue = {
  billingType: BillingType | null;
  /** Plan revenue in `displayCurrency`, or null when the plan can't be priced: no billing
      model, or no counted roles (unbuilt / all-cancelled). The second case is why this
      isn't just `totals.revenue` — T&M sums to a confident 0 over an empty plan. */
  revenue: number | null;
  convertedFrom: Currency[];
};

export async function getPlanRevenueByProject(
  billing: Map<string, MarginBilling>,      // supplied by the caller, which already joins projects
  displayCurrency: DisplayCurrency,
  usdRates: Record<Currency, number>,
): Promise<Map<string, PlanRevenue>>;
```

**One query**: `project_roles` with `inArray(projectRoles.projectId, ids)` selecting exactly the
`MarginRoleInput` columns (`id, projectId, status, startDate, endDate, roleType, hoursPerDay, billRate,
staffId`, plus a literal `staffHourlyCost: null`), folded into `Map<projectId, MarginRoleInput[]>`, then
`computeProjectMargin({ …, openRoleCostUsd: {}, includeCost: false })` per project, reading only
`totals.revenue`, `countedRoleCount`, `convertedFrom`. Empty Map short-circuit on empty input.

Header comment: `includeCost: false` + `openRoleCostUsd: {}` means **no compensation is read and
`staff_employment` is never queried**; `projects.viewMargin` is irrelevant because revenue is ungated
(ADR 0053 §7 / 0066 §9); adding a `billRateFor` lookup here would re-price historical plans (ADR 0066 §8).

### 3b. `src/actions/crm/getOrgPipeline.ts`

```ts
export async function getOrgPipeline(): Promise<OrgPipeline>;

export type OrgPipeline = {
  all: PipelineSummary;                                        // every open funnel deal
  byLineOfBusiness: Record<LineOfBusiness, PipelineSummary>;   // the same fold, per LoB
  displayCurrency: DisplayCurrency;
  convertedFrom: Currency[];
  rates: ExchangeRates;                                        // asOf/stale for FxRateNote
  today: string; weekStart: string; monthStart: string;        // so the UI can label each block
};
```

`PipelineSummary` and friends are defined in the pure module (§4b) and re-exported through here —
nothing enumerated twice.

**Pre-folded per filter value, and that is the load-bearing decision.** This renders inside
`LazerStatusSection`, a Client Component, so its props serialize into the page HTML for every viewer.
The panel renders **no per-deal row at all** — only counts and band totals — so unlike `OrgPerson`
there is nothing to itemize. Shipping 6 small aggregates instead of N deal rows means **no deal name,
company name, owner name, opportunity id, project id or per-project figure ever crosses the boundary**,
and ADR 0063 §6's "filtered counts must be recomputed, never reuse server totals" is satisfied *by
construction*: every filter state has its own server-computed fold from the same rows by the same
function, so a filtered count cannot drift.

**3 DB queries + 1 cached fetch:**

| # | Query |
|---|---|
| Q1 | `opportunities LEFT JOIN projects` → `{status, lineOfBusiness, projectId, billingType, budgetAmount, budgetCurrency}` `WHERE status IN FUNNEL_STATUSES` |
| Q2 | `opportunities` → `{status, lineOfBusiness, closedAt}` `WHERE status IN CLOSED_OPPORTUNITY_STATUSES AND closed_at >= :bound` |
| — | `getExchangeRates()` — 12h-cached fetch, never throws |
| Q3 | `getPlanRevenueByProject(midBottomBilling, …)` — one `project_roles` query |

Q1/Q2/FX run in one `Promise.all`; Q3 follows Q1.

- `FUNNEL_STATUSES` comes from the pure module — the WHERE clause and the bands cannot disagree.
- Q1's LEFT JOIN carries billing on the deal row, which is why §3a needs no `projects` query; a shared
  project repeats its billing across rows, deduped by `projectId` into the `MarginBilling` map.
- **Q2's bound**: `const windowStart = weekStart < monthStart ? weekStart : monthStart;` then
  `gte(opportunities.closedAt, parseIsoDate(addDays(windowStart, -1)))`. The extra day is deliberate —
  `closedAt` is a plain `timestamp` and the bound a local-midnight `Date`, so a session-timezone skew
  could otherwise *exclude* a boundary-day row. **The JS fold is authoritative**: `summarizeClosed`
  re-buckets from the row's ISO day, so skew can over-fetch by hours but never mis-file a figure.
  Comment it — this is the sort of thing that gets "simplified" away.
- Q3 fetches roles only for Mid+Bottom projects (Top reports no money).
- No capping. The closed set is window-bounded; the open funnel is small. Note it so nobody adds a cap
  by analogy with `CAPPED_BOARD_STATUSES` (whose point is that *closed* columns grow forever — and
  those are windowed here).
- **No gate**, with the "deliberately untouched permissions" comment from *Decisions* §3.
- Currency: `PIPELINE_DISPLAY_CURRENCY: DisplayCurrency = "CAD"` in the pure module, commented as
  matching `MARGIN_FLAG_CURRENCY`'s *value* but not being that constant (different question), and no
  toggle on `/` — a toggle means client state and a second figure to reconcile; the footnote names the
  currency instead.

### 3c. `src/actions/crm/getMyPipeline.ts`

`const staffId = await getCurrentStaffId(); if (!staffId) return EMPTY;` — the `getMyTasks` shape. No
`staffId` on the return type (the caller already has it from `getMyAllocations`).

```ts
export type MyDealNextStep = { id: string; description: string };
  // narrowed from OpenTaskSummary: ownerId/ownerName dropped — every task here is already yours.

export type MyDealView = {
  opportunityId: string; name: string; companyName: string;
  status: OpportunityStatus;
  /** The linked project's full plan revenue in `displayCurrency`; null = unpriced.
      Deliberately the WHOLE project's revenue, matching this deal's plan drawer — see §8. */
  value: number | null;
  billingType: BillingType | null;
  nextSteps: MyDealNextStep[];        // open tasks, oldest first (openTasksByParent order)
};

export type MyPipelineView = {
  stages: MyPipelineStage[];          // non-empty funnel stages, pipeline order
  closed: ClosedWindows;
  displayCurrency: DisplayCurrency; convertedFrom: Currency[]; rates: ExchangeRates;
  today: string; weekStart: string; monthStart: string;
};
```

Built field-by-field in a `toMyDealView(row)` — **never spread** — carrying `MyTaskView`'s whitelist
docstring. Note the consequence: this block renders as a **Server Component**, so none of it crosses a
serialization boundary today — the enumeration stays because it is one `"use client"` away from doing so.

**4 DB queries + the shared cached fetch:**

| # | Query |
|---|---|
| Q1 | `opportunityOwners ⋈ opportunities ⋈ companies LEFT JOIN projects` `WHERE ownerStaffId = :me AND status IN FUNNEL_STATUSES` → id, name, companyName, status, projectId + billing |
| Q2 | same join, `WHERE … status IN CLOSED_… AND closed_at >= :bound` → `{status, closedAt}` |
| Q3 | `getPlanRevenueByProject(allMyBilling, …)` — all my deals' projects (Your Status shows a size at every stage) |
| Q4 | `openTasksByParent("opportunity", myOpportunityIds)` |

`opportunity_owners_unique` on `(opportunityId, staffId)` means no join fan-out. FX is the same
`getExchangeRates()` the org read makes — Next's fetch cache dedupes it within the request.

### 3d. Two reads, one shared helper — not one read

(1) The two blocks live in two bands that ADR 0063 keeps as **sibling async Server Components precisely
so their reads overlap**; one read forces them into one tree and serializes the page. (2) The payloads
want opposite shapes — the org block needs aggregates and must ship no names; the personal block needs
names, tasks and per-deal money and ships nothing at all. (3) The personal read must be own-data-only
*by construction*, which a superset-then-filter read is not. Cost: `opportunities` is scanned twice —
noise at this table's size, and the expensive half (`project_roles`) covers near-disjoint id sets anyway.

---

## 4. New pure modules

### 4a. `src/lib/crm/opportunity-close.ts` + `.test.ts` — see §2

Tests: open→closed stamps `now`; closed→closed keeps `previous` (both `won→won` and `won→lost`);
closed→open → `null`; open→open → `null`; insert at `closed_lost` stamps `now`, insert at an open
status → `null`. Then the invariant that earns the file under ADR 0037: **for every ordered pair in
`OPPORTUNITY_STATUSES × OPPORTUNITY_STATUSES`, the result is non-null iff `isClosedStatus(next)`** — the
DB CHECK restated in TS, a 196-case cross-representation (SQL↔JS) contract no type expresses.

### 4b. `src/lib/home/pipeline.ts` + `.test.ts`

Pure, client-importable, no drizzle/React — sibling to `org-status.ts` / `my-work.ts` / `my-tasks.ts`,
and explicitly **not** a third aggregator in `src/lib/timesheets/utilization.ts` (ADR 0063 Consequences).

```ts
export type FunnelBandId = "top" | "mid" | "bottom";
export type FunnelBand = {
  id: FunnelBandId;
  label: string;                             // "Top of funnel" | "Mid funnel" | "Bottom of funnel"
  groupIds: readonly OpportunityGroupId[];   // top: lead,qualifying · mid: scoping,allocating
                                             // bottom: negotiating,closing
  reportsValue: boolean;                     // Mid+Bottom only: money once the work is scoped
};
export const FUNNEL_BANDS: readonly FunnelBand[];
/** Pipeline groups deliberately outside every band, each with its reason. */
export const NON_FUNNEL_GROUP_IDS: readonly OpportunityGroupId[];   // ["maturing","won","lost"]
/** Every leaf status in a band, in OPPORTUNITY_STATUSES order — the reads' WHERE list. */
export const FUNNEL_STATUSES: readonly OpportunityStatus[];
export const PIPELINE_DISPLAY_CURRENCY: DisplayCurrency;            // "CAD"
export function bandOfStatus(status: OpportunityStatus): FunnelBandId | null;
```

**Module-load assertion**, in the spirit of `opportunity-pipeline.ts`'s existing lockstep guard: the
bands' `groupIds` ∪ `NON_FUNNEL_GROUP_IDS` must equal `OPPORTUNITY_GROUPS.map(g => g.id)`, each exactly
once, bands in pipeline order. This makes "Maturing is omitted" **structural rather than an omission** —
add a tenth pipeline group and the module throws at import until someone classifies it. Reasons go in
`NON_FUNNEL_GROUP_IDS`' docstring: Maturing because it's a holding pen the funnel doesn't forecast from
(a product decision, recorded so nobody "fixes" it back in); won/lost because they're outcomes, counted
separately and windowed.

```ts
export type StageCount = { status: OpportunityStatus; label: string; count: number };
export type BandValue = {
  /** Σ plan revenue over DISTINCT fixed-fee projects in this band. Null — never 0 — when
      nothing in the band is priced. */
  fixedFee: number | null;
  timeAndMaterials: number | null;
  total: number | null;          // stated, not left to the reader; null iff both are
  unpricedDeals: number;         // open deals with no priceable plan
  pricedProjects: number;        // distinct projects behind `total` — the honest denominator
};
export type FunnelBandSummary = {
  id: FunnelBandId; label: string;
  deals: number;                 // open DEALS, not projects
  stages: StageCount[];          // per-leaf, pipeline order, zero rows RETAINED (filter-stable)
  value: BandValue | null;       // null for Top: deliberately reports no money
};
export type ClosedCounts = { won: number; lost: number };
export type ClosedWindows = { week: ClosedCounts; month: ClosedCounts };
export type PipelineSummary = { bands: FunnelBandSummary[]; closed: ClosedWindows; openDeals: number };

export function summarizeFunnel(
  deals: readonly { status: OpportunityStatus; projectId: string | null }[],
  revenueByProject: ReadonlyMap<string, { billingType: BillingType | null; revenue: number | null }>,
): FunnelBandSummary[];
export function summarizeClosed(
  rows: readonly { status: OpportunityStatus; closedOn: string }[],   // ISO day
  weekStart: string, monthStart: string,
): ClosedWindows;
export function summarizePipeline(deals, revenueByProject, closedRows, weekStart, monthStart): PipelineSummary;
/** Non-empty funnel stages in pipeline order, each with its deals and their Σ value. */
export function groupMyDealsByStage(deals: readonly MyDealView[]): MyPipelineStage[];
```

`MyDealView` comes in via `import type` from the read — the same erased cross-`server-only` import
`my-tasks.ts` already does for `MyTaskView`.

**Dedupe is per band.** A project reached by two deals in the same band contributes once; a project
reached from two different bands contributes to each. Honest because there is deliberately **no
org-wide total pipeline value** for the double-count to corrupt, and collapsing across bands would need
a rule for which band owns a shared project that the data can't support. Comment it — a reader will
otherwise "fix" it.

**Tests assert:** (1) the band partition covers every `OPPORTUNITY_GROUPS` id exactly once and the
excluded three are `maturing`/`won`/`lost`; (2) `FUNNEL_STATUSES` equals the flattened band statuses in
`OPPORTUNITY_STATUSES` order and contains neither `maturing` nor a closed status; (3) leaf counts sum to
their band's `deals` and zero-count leaves survive; (4) two deals, one band, one project →
`deals: 2, pricedProjects: 1`, value once; (5) two deals in different bands on one project → each band
counts it (the deliberate cross-band double count); (6) all four unpriced cases — no `projectId`, null
`billingType`, T&M with `revenue: null`, cancelled-only plan — plus fixed-fee → `fixedFee` and T&M with
roles → `timeAndMaterials`; (7) `total === fixedFee + timeAndMaterials`, `null` when both are; (8) a band
with deals but nothing priced reports `total: null`, **never `0`**; (9) closed windows — a row on
`weekStart` is in `week`, on `monthStart` in `month`, **the straddle (`weekStart < monthStart`) puts a
row in `week` and not `month`**, and neither figure is a subset of the other; a row before both is in
neither; (10) won/lost split, and a non-closed status among the rows is ignored, never counted as a win;
(11) empty inputs → every band present, `deals: 0`, `value: null` for Mid/Bottom, zeros throughout;
(12) **disclosure** — build an `OrgPipeline`-shaped payload from rows carrying a deal name, company name
and project id, and assert `JSON.stringify(payload)` contains none of them (the mutation-tested form
ADR 0063 §5 requires, as in `org-status.test.ts`); (13) `groupMyDealsByStage` — pipeline order, empty
stages dropped, per-stage Σ over known values with `null` when none priced, `nextSteps` order preserved.

---

## 5. Components and wiring

| Path | Kind | Why |
|---|---|---|
| `src/components/home/pipeline-panel.tsx` | client-compiled, **no `"use client"` directive** | Rendered by `LazerStatusSection` (already a Client Component), so it's in the client bundle regardless — the exact relationship `project-roles-panel.tsx` / `borrowed-staff-panel.tsx` / `upcoming-time-off-panel.tsx` already have (none carries the directive). It holds **no state**: it receives the already-selected `PipelineSummary` plus the three date strings. Don't add the directive; don't reach for `useState`. |
| `src/components/home/my-pipeline-panel.tsx` | **true Server Component, zero client JS** | Rendered by `YourStatusSection`. Nothing filters, searches or ticks, so unlike `MyTasksPanel` (client, for search + parent filter + optimistic done-state) it needs no client JS, and its per-deal money never leaves the server. State the contrast in the docstring so nobody "matches the pattern" of the panel above it. |

Both write apostrophes **literally** (`doesn't`, not `&apos;`) — `pipeline-panel.tsx` because it's
client-compiled and hits the SWC leading-space hydration bug (`staffing-panel.tsx` carries the standing
comment), `my-pipeline-panel.tsx` because it's one directive away from the same bug.

Neither `InlineNotice` nor `StatCard` changes, and neither becomes a Client Component (their `icon` prop
is a component reference). Both panels use the private `Figure` pattern from `staffing-panel.tsx`
(duplicated locally, as `staffing-panel` already does — hoisting a shared four-line component is a
separate call). `EmptyState` for no-deals; `ScrollList` for the personal deal list (unbounded).

### Placement, and the line-of-business filter

**Inside `LazerStatusSection`, and it responds to the LoB filter.** `HomeSection`'s docstring reserves
the `action` slot for something that changes *every* figure below it, and ADR 0063 §6 makes "one filter,
one meaning" a rule — a pipeline card under that control that ignored it would be the classic
filtered-dashboard bug (unchanged numbers above a filtered list).

Wiring: `LazerStatusSection` takes a second prop `pipeline: OrgPipeline` and selects with the state it
already holds — `lineOfBusiness === null ? pipeline.all : pipeline.byLineOfBusiness[lineOfBusiness]`.
No client arithmetic. Placement: directly **after `<StaffingPanel/>`**, before the availability /
time-off grid — Staffing answers "is the bench working", Pipeline answers "what's coming to keep it
working"; the two org aggregates belong adjacent, above the person-level lists.

**Semantic wrinkle to record, not to slip in quietly:** on the staffing panels the filter matches a
person's *home* LoB, and ADR 0063 §6 explicitly *rejects* matching the work's LoB (a free person has no
work to match). A deal has no person, so it can only match `opportunities.lineOfBusiness` — the deal's
own. That's a coherent extension of "the control names a line of business", but §6's current text reads
as forbidding it, so it needs an **amendment**. (Alternative considered and rejected: a third band with
no filter and zero client JS — rejected because the brief puts this in Lazer Status, and a card sitting
under a band-scoping control while ignoring it is worse than an amendment.)

### The point-in-time vs windowed tension

Resolve it exactly as the ADR 0065 amendment did for Your Status: **the band description does not
change**, and **each block names its own window**.

- Pipeline card `CardAction`: `Open now · {formatShortDate(parseIsoDate(today))}` — stage counts and band
  values are point-in-time.
- Closed figures sit in their **own sub-row under a `border-t`** with a small "Closed deals" caption:
  four `Figure`s whose hints name the window as **dates**, not the bare words —
  `Won this week` / `Lost this week` with `Closed {formatDateRange(weekStart, today)}`, and
  `Won this month` / `Lost this month` with `Closed since {formatShortDate(parseIsoDate(monthStart))}`.
  Existing formatters only; no new date helper. Dates rather than words is also what stops a reader
  treating the week figure as a subset of the month's.
- Card footnote carries the three otherwise-silent caveats: **"Excludes Maturing"**; **"Value is each
  linked project's plan revenue, counted once per project — several deals can share one project"**; and
  `Plan value in CA$`, followed by `<FxRateNote rates={rates} from={convertedFrom} to={displayCurrency} />`
  (renders nothing when nothing was converted).

The personal panel mirrors it: `<h3>Pipeline</h3>` + caption *"Deals you own — open right now. Excludes
Maturing."*, the stage list with per-deal value and next steps, then the same four closed `Figure`s with
the same window hints. Shape matches `MyTasksPanel` (h3 + caption + body, no `Card`), so Your Status
reads as three blocks each naming its own window — where ADR 0065 already put that band.

### `src/app/(app)/page.tsx`

- `YourStatusSection`: add `getMyPipeline()` to the existing
  `Promise.all([getStaffPto, getStaffUtilization, getMyTasks])`; render `<MyPipelinePanel …/>` after
  `MyTasksPanel`.
- `OrganizationSection`: `const [grid, pipeline] = await Promise.all([getAllocationsGrid(), getOrgPipeline()])`;
  pass `pipeline` alongside `status`.
- Top docstring gains a sentence: Lazer Status now carries one **windowed** block, so the per-block
  window rule applies on **both** bands.

### Suspense — none, deliberately

Both new reads run *inside the two existing sibling Server Components*, so they overlap with
`getAllocationsGrid` / `getStaffUtilization` rather than extending the critical path; their cost is 7
small indexed queries against tables with dozens-to-hundreds of rows, an order of magnitude under
`getAllocationsGrid` (the page's actual floor); and a boundary around the pipeline card would stream the
*cheap* half of a band while the reader waits for the expensive half. `src/app/(app)/loading.tsx` stays
the only fallback. The one new latency risk is honest: `/` gains its **first external HTTP dependency**
in `getExchangeRates` — 12h-cached, never throws, falls back to `FALLBACK_USD_RATES` with `stale: true`
(which `FxRateNote` surfaces), but the first request per window pays a round trip. Revisit trigger, in
the code: if that fetch is ever made uncached, or the org read grows a whole-book role scan, the route's
first `Suspense` belongs around `OrganizationSection`, not the card. (FX is not optional — summing a CAD
fixed fee with a USD-rate T&M plan into one band total requires conversion; the only FX-free design is
to stop reporting a band total.)

---

## 6. Revalidation

`/` is dynamic (it reads cookies), so `revalidatePath` here is about the **client Router Cache** —
without it, navigating back to `/` after moving a card serves a stale RSC payload.

Add to `src/actions/crm/revalidate.ts`, beside `revalidateCompany`/`revalidateContact`:

```ts
/** Revalidate what an opportunity write changes: the board/list, and now `/` — the home
    dashboard carries the pipeline band and your own owned deals, so a status move, create,
    delete, LoB change, owner change, project link and task write all move figures there.
    One function so "what does an opportunity write affect" has one answer. */
export function revalidateOpportunity(): void {
  revalidatePath("/opportunities");
  revalidatePath("/");
}
```

Grep for `revalidatePath("/opportunities")` and convert **every** site: `updateOpportunityField`,
`updateOpportunityPosition`, `createOpportunity`, `deleteOpportunity`, `associateOpportunityProject`,
`removeProjectFromOpportunity`, `createProjectFromOpportunity`, and **`taskParent.ts`'s
`revalidateTaskParent` opportunity branch** (that's what refreshes the personal next-steps list when a
task is ticked on the board). A site left behind is a stale dashboard, not an error.

**Deliberately out of scope, with a stated reason:** the nine project-side writers that move a *plan's*
revenue (`createProjectRole`, `updateProjectRole`, `deleteProjectRole`, `duplicateProjectRoles`,
`extendProjectRole`, `bumpProjectRoles`, `assignRoleStaff`, `allocateStaffToRole`, `updateProjectField`'s
budget case) do **not** gain `revalidatePath("/")`. Threading it through nine writers has high omission
risk and invisible payoff — one role edit moves a band aggregate by a rounding-scale amount, and nobody
watches `/` while editing a plan. So `/`'s band *values* may lag a plan edit until the next full load,
while *membership* figures (counts, stages, closed) are always fresh. Record as accepted staleness with
a revisit trigger: if a pipeline value ever becomes a commitment number, do it with a cache tag per
ADR 0067's `updateTag` pattern rather than by sprinkling paths.

---

## 7. Build order

1. `src/lib/crm/opportunity-close.ts` + `.test.ts` (no dependencies; TDD the transition table). `bun run check`.
2. Schema: `closedAt` + CHECK + index. `bun run db:generate`, hand-edit `0027_*.sql` (move the backfill
   between `ADD COLUMN` and `ADD CONSTRAINT`, add the comment block), `bun run db:migrate`. Never
   regenerate it after.
3. Wire the **three** writers through `closedAtFor`. `tsc` won't catch a forgotten writer — the CHECK
   plus the `update(opportunities)` grep is the verification.
4. Seed: `sales.ts` `closedAt` spread + the week-start fixture; `projects.ts` open Mid/Bottom links, two
   sharing a project. `bun run check` (the seed imports real tables, so tsc is the drift guard). Do
   **not** run `db:seed` unless asked — it truncates.
5. `src/lib/home/pipeline.ts` + `.test.ts`, test-first. All the real logic is here; §4b's tests are the
   feature's acceptance criteria.
6. `getPlanRevenueByProject.ts`, then `getOrgPipeline.ts` and `getMyPipeline.ts`.
7. `pipeline-panel.tsx` + `LazerStatusSection`'s second prop; `my-pipeline-panel.tsx` + `YourStatusSection`;
   `page.tsx` docstring.
8. `revalidateOpportunity` + the call-site sweep.
9. **ADR 0069** — the `closedAt` column and its backfill; deal size = the linked project's plan revenue
   and the per-deal / per-band definitional split (§8.4); Maturing omitted; the two ADR 0063 amendments
   (Lazer Status now carries a windowed block; the LoB filter matches a *deal's* own LoB). Then dispatch
   the **librarian** for `docs/domains/crm.md` (a "Pipeline on the home dashboard" subsection beside the
   existing personal-task-list one, plus `closedAt` under Key entities), `docs/data-model.md`,
   `docs/development.md`'s seed paragraph, and the AGENTS.md status paragraph.

## Verification

- `bun run check` (Biome + `tsc --noEmit` + `bun test`) after each step; `bun run build` at the end.
- **The app is never run** — no dev server, no screenshots. Those two commands plus the unit tests are
  the evidence. If runtime evidence is genuinely needed, ask for it.
- Unit tests pin every judgement the feature makes: the band partition, the per-band dedupe, the four
  unpriced cases, the week/month straddle, the won/lost split, the transition table, and the payload
  whitelist. They do **not** cover SQL (no DB in `bun test`) — the `WHERE status IN FUNNEL_STATUSES`
  clause is guarded instead by deriving the list from the pure module plus the module-load assertion,
  and the `closedAt` timezone bound by making the JS fold authoritative.
- Run **`/audit-rbac`** before claiming done: the feature adds two ungated reads over commercial data,
  and it should ask about them — which is why the "no permission change, and here's why" comment goes in
  both read headers.
- Then **`/code-review`** on the diff.

## 8. Risks and open honesty problems

1. **`createOpportunity` is the easily-missed third writer.** With the CHECK, omitting it turns a
   create-as-`closed_lost` into a 500 — the right failure, but it must be wired.
2. **"This week" ⊄ "this month"** — affects the SQL bound, the fold *and* the labels. Two figures that
   look nested but aren't is exactly the ADR 0063 failure mode; hence dates in the hints.
3. **T&M with no roles reads as a confident $0** unless classed unpriced.
4. **The one I'd flag hardest: "deal value" is not quite what we're computing.** Deal size is the
   *linked project's whole* plan revenue. A project fed by an original deal plus two extensions
   attributes the **full project value to each of the three** in Your Status, while the band total counts
   it **once** — so the per-deal figure and the band total use different definitions of one word.
   Mitigation inside this feature: never label either "Deal value" — use **"Project plan value"** per
   deal and **"Plan value · counted once per project"** per band, plus the footnote. Proper fix, out of
   scope and worth naming as a follow-up: an explicit `opportunities.value` column, or an apportionment
   rule — a product decision the data can't currently substitute for. This is the one place where
   shipping the requirement as stated could put a number on screen a salesperson would dispute.
5. **The `updatedAt` backfill is visibly wrong for about a month** — any long-closed deal whose row was
   touched recently lands in "closed this month". Accepted, commented in the SQL, self-healing; say it in
   the ADR so the first person who spots it doesn't file a bug.
6. **Omitting Maturing means the bands don't sum to the board's open cards** — captioned on both blocks,
   and carried structurally by the module-load assertion.
7. **The LoB filter's meaning widens** (person's home LoB → the deal's own LoB for deal rows). Coherent,
   but needs the ADR 0063 §6 amendment, not a quiet reinterpretation.
8. **Lazer Status stops being purely point-in-time** — a genuine ADR 0063 §1/§2 amendment, symmetric with
   what 0065 did to Your Status. The alternative (dropping the closed counts) removes the only figure on
   the page that says whether the org is *winning*, so the amendment is the right trade — it just has to
   be written down.
9. **Payload regression risk** if the pre-folded org design is later "simplified" into shipping deal
   rows. The `JSON.stringify` test is the guard — make it assert on names/ids a spread would reintroduce,
   so it fails loudly rather than passing vacuously.
