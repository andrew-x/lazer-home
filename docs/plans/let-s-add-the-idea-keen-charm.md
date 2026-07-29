# Project budgets & margin

## Context

A project today carries no commercial information at all — `projects` is deliberately thin (name + company), and `docs/domains/projects.md` states outright "no budget/value, no rates". That means the allocations planner can tell you *who* is on a project and for how long, but never whether the work is priced sensibly or profitable. Deal-side planning in the opportunity drawer has the same blind spot: you can staff a plan and win the deal without ever seeing what it earns or costs.

This adds the missing half:

- **A billing model on every new project** — **fixed fee** (one total + currency) or **time & materials** (an hourly bill rate + currency per role type). Required in the create form, on both the standalone flow and the opportunity flow.
- **A budget & margin summary in the project plan**, on both the opportunity's Project-plan tab and the project detail page — revenue, cost, margin, plus per-role figures in the planner grid.
- **Cost from real compensation** — a staffed role costs that person's pay restated hourly; an open role costs the company average for its discipline.
- **A CAD/USD display toggle**, with a per-value warning icon whenever a figure required an FX conversion, naming the rate used.

Cost figures are derived from individual salaries, so margin sits behind a new explicit capability rather than riding on `projects.edit`.

### Decisions made (do not re-litigate during implementation)

| Decision | Choice |
|---|---|
| T&M rate granularity | A project **rate card keyed by role type** (child table), not per staffing line |
| Rate-card defaults | Hardcoded in a code module — flat **225 USD/hr** for all five role types, prefilled and editable (the `compensation-targets.ts` code-as-policy precedent) |
| Mixed currencies in a rate card | **Non-blocking warning**, never a validation error |
| Cost basis | full-time `base / HOURS_PER_YEAR`; hourly `hourlyRate` |
| Open-role cost | Company-wide average hourly cost for the matching staff role; `SPECIALIST` → average of all billable-discipline staff |
| Budget at creation | **Required**; pre-existing projects stay null and read as "No budget set" |
| Who sees cost/margin | New **`projects.viewMargin`** capability → admin, manager, finance, delivery-manager. **Not sales, not user** — they see revenue only |
| Fixed-fee per-role rows | **Hours + cost only, no per-role revenue or %** — the margin % appears only in the summary panel, where it is true. T&M rows show revenue/cost/margin |
| Role status | Everything except `cancelled` counts toward budget |
| PTO | Ignored — cost accrues during leave, so netting it off hours would move revenue without moving cost |

---

## 1. Pure modules (build first, no dependencies)

**`src/lib/projects/project-billing.ts`** (new) — client-safe enum source, mirroring `src/lib/projects/project-role-type.ts`:
`BILLING_TYPES = ["FIXED_FEE","TIME_AND_MATERIALS"]`, `BillingType`, `BILLING_TYPE_LABELS` (`"Fixed fee"` / `"Time & materials"`).

**`src/lib/projects/bill-rates.ts`** (new) — code-as-policy defaults, written beat-for-beat like `src/lib/performance/compensation-targets.ts` including its "why code and not a table" paragraph and ⚠️ PLACEHOLDER caveat:
`BILL_RATE_CURRENCY = "USD"`, `BILL_RATES_REVIEWED_ON`, `DEFAULT_BILL_RATES: Record<ProjectRoleType, number>` (all `225`), `defaultRateCard()` returning one row per role type in `PROJECT_ROLE_TYPES` order. Total, not `Partial` — every row is prefilled.

**`src/lib/projects/project-role-type.ts`** (edit) — add `STAFF_ROLE_FOR_PROJECT_ROLE_TYPE: Record<ProjectRoleType, Role | null>` (ENGINEER/DESIGNER/ARCHITECT/QA map 1:1, `SPECIALIST: null`). Use **`import type { Role }`** — this module is value-imported by `projects-schema.ts`, so a value import from `staff-enums` would close a runtime cycle (the same caveat `compensation-targets.ts` carries).

**`src/lib/format/currency.ts`** (edit) — add `CURRENCY_LABELS` (identity map; `EnumSelect` requires `labels`), and move `DISPLAY_CURRENCIES` + a `DisplayCurrency` type here from `src/components/performance/dashboard-filters.tsx`, re-pointing that one import.

**`src/lib/format/fx.ts`** (edit) — add conversion *provenance*, since the warning icon is per value:
```ts
export type FxAmount = { amount: number; converted: boolean };
export function convertTagged(amount, from, to, usdRates): FxAmount;
/** A total is flagged when ANY contributing value was converted. */
export function sumFx(parts: FxAmount[]): FxAmount;
```

**`src/lib/projects/project-margin.ts`** (new) + `.test.ts` — all the money math, pure and client-importable (the `plan-summary.ts` / `project-planner-grid.ts` precedent), so the currency toggle recomputes client-side with no refetch (ADR 0029's rule: ship native amounts + a rate table).

- `roleBillableHours(role)` = **`countWorkingDays(startDate, endDate) × hoursPerDay`**, reusing `countWorkingDays` from `src/lib/staff/pto-working-days.ts`. Do **not** derive money from `weekPercent`/`bucketPercent` — per ADR 0040 a month column shows a flat nominal *rate*, not a prorated quantity, so grid percentages would be wrong by whole weeks. Put that sentence in the docstring. Do not export `activeWeekdays`/`totalWeekdays` from `allocations-grid.ts` (they clip a span to a bucket — a grid concern); `allocations-grid.ts` needs no change.
- `countsTowardBudget(status)` = `status !== "cancelled"`.
- `computeProjectMargin({ billing, rateCard, roles, openRoleCostUsd, displayCurrency, usdRates, includeCost })` → `{ perRole, totals, unknownCostRoleCount, mixedCurrencies, converted flags }`.
  - **T&M**: per-role revenue = `hours × rateCard[roleType].hourlyRate`, converted+tagged; totals = Σ.
  - **Fixed fee**: per-role revenue `null` (decided); `totals.revenue = convert(budgetAmount, budgetCurrency, …)`.
  - **No budget** (`billingType === null`): all revenue `null`.
  - **Cost** (when `includeCost`): staffed → that person's native hourly cost × hours; open → `openRoleCostUsd[roleType]` × hours with `costIsEstimated: true`; neither → `cost: null` and `unknownCostRoleCount += 1` so a partial total can be labelled honestly.
  - `marginPercent = revenue > 0 ? margin / revenue : null` — never `NaN`, and never "100% margin" on an empty plan.
- `resolveDisplayCurrency({ budgetCurrency, rateCard })` — the budget's own currency when it is CAD/USD, else the most common rate-card currency, else USD. Rationale: rate-card defaults are USD, so a blanket CAD default would greet every new project with warning icons on figures that needed no conversion.

Also add `formatPercent(fraction | null)` → `"34.9%"` / `"—"` to `src/lib/format/format.ts` (`formatChangePercent` always signs, which is wrong for a margin).

---

## 2. Schema & migration

**`src/lib/db/projects-schema.ts`** — `projectBillingTypeEnum = pgEnum("project_billing_type", [...BILLING_TYPES])` (domain-prefixed like its siblings). `projects` gains three **nullable, no-default** columns and its first extras callback:

```ts
billingType: projectBillingTypeEnum(),
budgetAmount: numeric({ precision: 12, scale: 2, mode: "number" }),
budgetCurrency: currencyEnum(),
```
plus a `check("projects_budget_shape", …)` making a half-written budget unrepresentable: all three null, **or** `FIXED_FEE` with amount + currency both set, **or** `TIME_AND_MATERIALS` with both null. Existing rows satisfy branch one — **no backfill**.

New table after `projectRoles`:

```ts
export const projectRoleRates = pgTable("project_role_rates", {
  id: text().primaryKey(),
  projectId: text().notNull().references(() => projects.id, { onDelete: "cascade" }),
  roleType: projectRoleTypeEnum().notNull(),
  hourlyRate: numeric({ precision: 12, scale: 2, mode: "number" }).notNull(),
  currency: currencyEnum().notNull(),        // per row — a card may mix currencies
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique("project_role_rates_unique").on(t.projectId, t.roleType)]);
export type ProjectRoleRate = InferSelectModel<typeof projectRoleRates>;
```
Id prefix `generateId("proj-rate")`. The unique's leading column is `projectId`, so it doubles as the lookup index — no extra index needed.

**Migration**: `bun run db:generate` → `drizzle/0014_<codename>.sql` (journal idx 14). **Verify the generated SQL actually contains the `projects_budget_shape` CHECK** — drizzle-kit has been inconsistent about emitting checks added to an *existing* table; hand-append the `ALTER TABLE … ADD CONSTRAINT … CHECK (…)` statement if missing (the snapshot already records it from the schema), then `bun run db:migrate` and confirm with `db:studio`. No multi-step SQL. The only "absent" state modelled anywhere in code is `billing_type IS NULL` = "No budget set", a permanent domain state.

---

## 3. Permissions — `projects.viewMargin`

The **deliberate three-file lockstep** (`.claude/rules/permissions.md`), all three in one commit:

1. `src/lib/auth/permissions.ts` — `projects: ["edit", "viewMargin"]` in `statement`; grant `viewMargin` to `delivery-manager` (alongside its existing `edit`), `finance`, `manager`, `admin`. `sales` and `user` unchanged.
2. `src/lib/auth/permissions.test.ts` — extend the matrix assertions for all six roles.
3. `docs/domains/permissions.md` — add the capability + its matrix column, with the one-line rationale (a project role's cost *is* an individual's compensation).

Why a new capability rather than reusing `staff.viewCompensation`: delivery managers are the primary viewers of a project plan and must see margin, but granting them blanket compensation access would be a much wider change. Why not fold it into `projects.edit`: `sales` reaches the plan through `loadOpportunityPlan` and must not receive compensation-derived data.

**⚠️ The live leak path.** `src/actions/projects/loadOpportunityPlan.ts` is gated on **`crm.edit`** (held by `sales`) and returns the whole `OpportunityPlan` to a client component; `getProjectPlan` SSRs into a client component the same way. Masking therefore lives **inside the reader** — the `getProjectPto` / `canSeeType` precedent — never in the client. Do not relax `loadOpportunityPlan`'s gate and do not rely on it.

Run `/audit-rbac` before calling this done; `bun run check` runs the matrix test.

---

## 4. Zod schemas

**`src/actions/projects/projectBudget.schema.ts`** (new) — client-importable, hand-written, drizzle-free (the create dialogs are `"use client"`). A **discriminated union on `billingType`**, mirroring the DB check constraint, so a fixed fee carrying rates is unrepresentable in the inferred type rather than merely invalid:

```ts
export const projectRoleRateSchema = z.object({
  roleType: z.enum(PROJECT_ROLE_TYPES),
  hourlyRate: z.coerce.number().positive("Enter an hourly rate greater than 0.").max(MAX_MONEY, …),
  currency: z.enum(CURRENCY),   // per row; NO cross-row equality rule
});

export const rateCardSchema = z.array(projectRoleRateSchema).superRefine(/* one row per role type, all five present */);

export const projectBudgetSchema = z.discriminatedUnion("billingType", [
  z.object({ billingType: z.literal("FIXED_FEE"),
             budgetAmount: z.coerce.number().positive(…).max(MAX_MONEY, …),
             budgetCurrency: z.enum(CURRENCY) }),
  z.object({ billingType: z.literal("TIME_AND_MATERIALS"), rateCard: rateCardSchema }),
]);
export type ProjectBudgetInput = z.input<typeof projectBudgetSchema>;
export type ProjectBudget = z.output<typeof projectBudgetSchema>;
```
`.positive()` on every money field is load-bearing: `z.coerce.number()` turns `""` into `0`, so without it a blank fee saves as $0.

Composed as a single **nested `budget` key** into `createProjectSchema`, `createProjectFromOpportunitySchema`, and a new `updateProjectBudgetSchema` — nested, not intersected, so `add-project-dialog.tsx`'s `Record<keyof CreateProjectInput, IssueTarget<…>>` guardrail stays exhaustive with exactly one new entry.

**Issue-path consequence:** `applyServerIssues` keys off `issue.path[0]`, so the dialogs must validate the budget slice **separately** — `projectBudgetSchema.safeParse(budgetValues)` — which yields `["rateCard", 0, "hourlyRate"]` paths the existing `NestedIssueTarget` already routes per row. No change to `apply-server-issues.ts`.

---

## 5. Write actions

**`src/actions/projects/projectBudgetWrite.ts`** (new, `server-only`, reached only through actions — the `src/actions/crm/opportunityLinks.ts` precedent):

- `projectBudgetColumns(budget)` → the three `projects` columns, with **explicit nulls** on the T&M branch so a FIXED_FEE → T&M switch clears the amount (otherwise the check constraint rejects it).
- `writeProjectRateCard(tx, projectId, budget)` — FIXED_FEE deletes all rows; T&M upserts on `onConflictDoUpdate({ target: [projectId, roleType] })` so re-saving keeps row ids stable. Set `updatedAt` explicitly (`$onUpdate` doesn't fire for an upsert `set`).

| Action | Change | Gate |
|---|---|---|
| `createProject.ts` | spread `projectBudgetColumns(...)` into the existing insert + `writeProjectRateCard` in the **same tx** | unchanged `projects: ["edit"]` |
| `createProjectFromOpportunity.ts` | same two edits in its existing tx; docstring loses "one-click … (no form)" | unchanged `projects: ["edit"]` |
| **`updateProjectBudget.ts`** (new) + `.schema.ts` | `assertRowExists` → tx: update the three columns + `writeProjectRateCard` → `revalidateProject(projectId)` | `{ action: "update-project-budget", permission: { projects: ["edit"] } }` |

`updateProject`, `updateProjectField`, `associateOpportunityProject` and every role action need **no change**. A dedicated `updateProjectBudget` (rather than extending `updateProject`) keeps one write per intent — folding it in would force a name edit to re-send a five-row rate card, the last-write-wins clobbering `updateProjectField` exists to avoid.

**Two call sites break at compile time** when `budget` becomes required (that's `tsc` doing its job — see §7).

---

## 6. Server reads

**`src/actions/shared/staffHourlyCost.ts`** (new, `server-only`, beside `employmentComp.ts`):
- `hourlyCostOf(row)` → `{ amount, currency }` — `hourlyRate` for HOURLY, `convertCompUnit(base, "ANNUAL", "HOURLY")` for FULL_TIME (the same flat 2080 the comp editor uses, deliberately not scaled by `utilizationTarget`).
- `getStaffHourlyCosts(staffIds)` → `Map<staffId, NativeMoney>`, two queries, no N+1.
- `getRoleTypeAverageCostsUsd(usdRates)` → `Partial<Record<ProjectRoleType, number>>`, averaged **in USD** so the client toggle needs no re-read and no per-person amount ever leaves the server. Reuse the established fold — `employmentCompColumns` + `latestEmploymentFirst` + `firstPerKey` (ADR 0007 effective-dating), then bucket by `STAFF_ROLE_FOR_PROJECT_ROLE_TYPE`. Not a SQL `avg() GROUP BY`: latest-row-per-staff lives in JS in this repo, and cross-currency averaging needs the FX table. A role type with **no matching staff is absent from the map, never 0** — "no basis" and "free" are different claims. `SPECIALIST` averages all `isBillableRole` disciplines (excluding LEADERSHIP/SALES/SOLUTIONS/OPERATIONS overhead).

**`src/actions/projects/getProjectCostBasis.ts`** (new, `server-only`) — **the single decision point** for "may this viewer see cost?". `getCurrentUser()` → `userHasPermission(user ?? { role: null }, { projects: ["viewMargin"] })`; on false return `{ canSeeMargin: false, costBasis: null }` **before touching `staff_employment`**.

**`getOpportunityPlan.ts` and `getProjectPlan.ts`** each gain the same additions:
- `PlanBudget = { billingType, budgetAmount, budgetCurrency, rateCard: {roleType,hourlyRate,currency}[] }` on `PlanProject` (`billingType: null` = no budget).
- Top-level `costBasis: PlanCostBasis | null`, `canSeeMargin: boolean`, `exchangeRates: ExchangeRates`.
- Query work: three columns added to the existing project `select`; a rate-card select ordered by `roleType` (a pgEnum sorts by declaration order = `PROJECT_ROLE_TYPES` order, so no JS re-sort — worth a comment); `getExchangeRates()` in a `Promise.all` with the other selects; `getProjectCostBasis` using the `staffIds` set the reader already derives for `externalAllocations`.

`getExchangeRates()` must run **inside** the readers, not at the page: the opportunity tab loads through `useAction(loadOpportunityPlan)` and can't receive SSR props. It's a 12h-cached `fetch` that never throws.

Optional, skippable in v1: a `billingType` chip on `getProjectsList.ts` cards.

---

## 7. UI

### 7a. Shared budget fields — `src/components/projects/budget-fields.tsx` (new)

The deliberate mirror of `src/components/projects/role-fields.tsx`: exports `BudgetFormValues`, `BUDGET_ISSUE_FIELDS`, `<BudgetFields>`, `budgetDefaultValues()`, `toBudgetInput()`. Generic over `T extends BudgetFormValues` with one documented narrowing helper so all three call sites stay cast-free.

- Billing type always visible via `EnumSelect` over `BILLING_TYPES`; then exactly one branch.
- **Fixed fee**: amount `Input type="number"` + currency `EnumSelect` over `CURRENCY`, side by side.
- **T&M rate card**: a bordered 3-column grid (`grid-cols-[7rem_1fr_5.5rem]`, `divide-y`) with **one static row per `PROJECT_ROLE_TYPES` entry — not `useFieldArray`** (rows are never added/removed/reordered; the repo has no `useFieldArray` call sites). `roleType` is *not* a form value — it's re-derived from the index at submit, so the form can't hold a role type disagreeing with its row. Prefilled from `defaultRateCard()`.
- **Mixed-currency warning**: derived state, rendered through a new `src/components/inline-notice.tsx` extracted from the neutral banner in `src/components/timesheets/timesheet-week.tsx` (`border bg-muted/40` + `IconAlertTriangle`) — migrate that file's two open-coded banners to it. It is **not** a `FormField error` and not a zod issue, so it cannot block submit or set `aria-invalid`.
- `toBudgetInput` must **drop the inactive mode's values**, or toggling billing type twice persists a phantom rate card.

Consumers: `add-project-dialog.tsx`, the new opportunity create dialog, and a new `src/components/projects/budget-dialog.tsx` (edit — the only way both surfaces get the same affordance, since the project detail page has no edit-project dialog; also the target of the "Set budget" button in the no-budget state).

### 7b. Create flows

`src/components/projects/add-project-dialog.tsx` — add `budgetDefaultValues()`, `watch("billingType")`, `<BudgetFields idPrefix="project" />`, `...BUDGET_ISSUE_FIELDS` in `FIELD_FOR_ISSUE`. Its component doc and `description` prop both currently assert the opposite of this feature ("collects only name and company", "projects from an opportunity skip this dialog entirely (one-click)") — rewrite both.

`src/components/projects/opportunity-plan/create-project-dialog.tsx` (new) — `NoProjectState`'s one-click button becomes a `FormDialog` trigger whose body is budget-only (name/company still inherited server-side). Must pass **`forceMountOverlay`** (the tab lives inside a Sheet — both existing dialogs in that folder do). Drop the old `toast.success`; the dialog closing and the tab flipping to the planner is the flow's own signal.

**`src/components/crm/opportunity-board.tsx` (~L577–592)** — the riskiest seam. The `ConfirmDialog` gating a drag into a delivery stage becomes a budget `FormDialog`. Preserve exactly: `onSuccess` still calls `completePendingMove()` (it patches `snapshotRef` so a failed status update reverts *with* `hasProject: true`), and **cancel must still drop the pending move** (`setProjectPrompt(null)` when `!next && !isPending`) so the card snaps back to its origin column. Guard close-on-outside-click while `isPending`.

### 7c. Plan summary

**Step 1 — pure refactor, no behaviour change:** extract the Length/Dates/Confirmed/Tentative/Delivery-managers tile row, duplicated near-verbatim in `opportunity-project-plan.tsx` (~405–443) and `detail/project-detail-view.tsx` (~190–219), into **`src/components/projects/plan-summary-tiles.tsx`** (owning the `rangeOf` memos; renders the Delivery-managers tile only when passed).

**Step 2 — `src/components/projects/budget-summary-panel.tsx` (new)**, a bordered panel rather than more `StatCard`s (whose `value` is typed `string` and so can't carry the FX icon, and which leaves nowhere for the toggle/badge/notices) and not a grid footer (this isn't a column total):

```
┌─ rounded-md border p-4 ────────────────────────────────────────────┐
│ Budget & margin  [Time & materials]             [CAD|USD]  [✎]     │
│ REVENUE            COST                MARGIN                      │
│ CA$412,000 ⚠       CA$268,400 ⚠        34.9% ⚠                     │
│ 1,830 hrs          8 roles · 2 open    CA$143,600                  │
│ ⚠ 1 role has no bill rate in the rate card — excluded from revenue. │
└────────────────────────────────────────────────────────────────────┘
```
Cost and Margin render only when `canSeeMargin`; Revenue always. For fixed fee the Revenue hint is the native figure (`Fixed fee · $325,000 USD`). Mounted after `<PlanSummaryTiles>` on both surfaces — on the project page **before `<Tabs>`**, since the budget is a property of the project, not of a tab.

### 7d. Per-role figures in the planner grid

`src/components/projects/opportunity-plan/planner-grid.tsx` — a **third line inside the existing sticky role-label cell**, under `{roleTypeLabel} · {hoursPerDay}h/day`, with a Tooltip carrying the breakdown. T&M rows show `34.9% margin`; **fixed-fee rows show hours + cost only** (per the decision). Threaded as **one new optional prop** — `margins?: { byRoleId: Map<string, RoleMargin>; currency; rates }` — so "off" (no budget, or no `viewMargin`) is a single `undefined`.

Explicitly **not** a new column: `PLANNER_SUB_LABEL_COL` is positioned by a hardcoded `sticky left-56` twinned to `PLANNER_LABEL_COL`'s `w-56`, and `src/components/planner/planner-columns.ts` is shared with the allocations grid — a third lead cell would shift the week spine on all three planners. Also not an expandable second `<tr>` (real `colSpan`-lockstep machinery for one number per row). `PlannerRow`/`buildPlannerRows` stay money-free, so `project-planner-grid.test.ts` is untouched.

### 7e. FX warning affordance — `src/components/converted-money.tsx` (new)

`<ConvertedMoney amount currency converted rates format? />` and a separately-exported `<FxWarningIcon rates />` (a percentage is conversion-tainted without being money). Built on the `WhenTooltip` recipe in `plan-expanded-panel.tsx` (~233–249) — Base UI's `render` prop, copy duplicated onto `aria-label`, `IconAlertTriangle className="size-3.5 shrink-0 text-muted-foreground"`. Copy:
- normal — *"Includes a currency conversion at today's rate (as of {asOf})."*
- `rates.stale` — *"Includes a currency conversion. Live exchange rates are unavailable, so an approximate fallback rate was used."*

`converted` is tagged at each leaf conversion and OR-propagated by `sumFx` through row → tile. This replaces the page-banner treatment on these surfaces; `dashboard-filters.tsx` and `plan-editor.tsx` keep theirs.

### 7f. Display-currency toggle

One `useState` per surface, owned by `PlanEditor` and `ProjectDetailView` (it must sit above both the panel and the grid's `margins` prop). Control: the hand-rolled `ToggleGroup` + `toEnumValue(DISPLAY_CURRENCIES, values[0] ?? null)` pattern from `dashboard-filters.tsx` — **not** `SegmentedFilter`, which prepends a meaningless "All". Default from `resolveDisplayCurrency`. A fixed-fee **input** is never re-denominated by the toggle (the `planned-comp-field.tsx` rule); only the summary figure converts, with the native amount as the muted hint.

### 7g. Empty / edge states

| Case | Behaviour |
|---|---|
| No budget (pre-existing projects; "Link an existing project" bypasses the form) | Panel collapses to "No budget set for this project." + a "Set budget" button (with `projects.edit`); no margin lines in the grid |
| T&M role type with no rate row | That role's revenue `null`, margin line shows `—` + warning tooltip, excluded from the total, and the panel counts such roles so the total is never silently wrong |
| Zero roles | T&M revenue/cost 0, margin `—` (never `NaN` or "100%"); fixed fee shows the fee with a "No roles yet" hint |
| Negative margin | Only losses get colour (the `changeTone` convention), via a local `marginTone` in `project-margin.ts` — don't import from a component dir, and `changeTone`'s `0 → muted` means "no change", not "0% margin". Round to display precision **before** choosing the tone so `−0.0%` never renders red |
| Staff with no employment row | Cost `null`, role excluded from the cost total, tooltip says so, panel flags the total as partial |
| Open role | Tooltip labels the basis — "Company average for Engineer (n = 12)" — so an averaged figure never reads as a real person's cost |
| `cancelled` role | Excluded from both totals; row renders muted with "excluded" |

---

## 8. Seed

`scripts/seed/wipe.ts` — add `"project_role_rates"` to `SEEDABLE_TABLES`, **child before parent** in the projects block.

`scripts/seed/projects.ts` — import `projectRoleRates`, `CURRENCY`, `DEFAULT_BILL_RATES`; add `type RoleRateInsert = InferInsertModel<typeof projectRoleRates>`. Pick a billing shape per project so all three states exist in real data: **~40% FIXED_FEE** (`money(80_000, 1_200_000)` + random currency), **~40% T&M** (five rows jittered around `DEFAULT_BILL_RATES[roleType]`, `BILL_RATE_CURRENCY` for most projects and per-row random currency for ~20% of them so the mixed-currency warning has something to warn about), **~20% no budget** so the empty state is exercised. Ids `generateId("rate")` (this file uses short local prefixes). Update the file docstring.

The new check constraint will now reject a sloppy seed row — that's the constraint working, and the seed is the cheapest place to find out.

---

## 9. Docs

Dispatch the **`librarian` subagent** after the code lands (per AGENTS.md) with a summary covering: `docs/domains/projects.md` (delete the "No budget/value, no rates" line at ~841), `docs/data-model.md` (new table + columns), `docs/domains/permissions.md` (the `viewMargin` row — must land with the code, not after), and a new **ADR 0052** recording the judgement calls: billing model on `projects` + per-role-type rate-card child table; code-as-policy rate defaults; hours from real weekdays not grid buckets (citing ADR 0040 explicitly); PTO and `cancelled` treatment; fixed-fee margin only at the project level; and the `projects.viewMargin` gate.

Also fix the stale prose asserting the opposite of this feature: `add-project-dialog.tsx:55`, `createProject.schema.ts:11`, `createProjectFromOpportunity.ts` + `.schema.ts` ("There's no form").

---

## 10. Build order

1. Pure modules (§1) + their tests.
2. Permissions three-file lockstep (§3) — early, so every read/gate below can reference it.
3. Schema → `db:generate` → **inspect the CHECK** → `db:migrate` (§2).
4. Seed (§8) → `db:seed` — proves the constraint and yields all three budget states.
5. Zod (§4), then writes (§5). `tsc` now lists the two broken UI call sites.
6. Cost + margin server side (§6).
7. Reader projections (§6).
8. `budget-fields.tsx`, `inline-notice.tsx`, `converted-money.tsx` (§7a, 7e).
9. Create/edit dialogs (§7b) — including the opportunity-board drag seam.
10. `plan-summary-tiles.tsx` extraction, then `budget-summary-panel.tsx` on both surfaces (§7c).
11. `planner-grid.tsx` per-role line (§7d).
12. Verification (§11), then docs + ADR (§9).

---

## 11. Verification

**Automated**
- `bun run check` — Biome + `tsc --noEmit` + `bun test`. Must include the updated `permissions.test.ts` matrix and the new `project-margin.test.ts` (a T&M plan with a known rate card and hours; a fixed-fee plan; zero roles → `marginPercent === null`; a cancelled role excluded; an open role using the average; a mixed-currency card producing `converted: true`).
- `bun run build` — non-trivial change, so run it.
- **`/audit-rbac`** — non-negotiable here. Specifically confirm no cost/margin field reaches a client from `loadOpportunityPlan` (the `crm.edit`/`sales` path) or `getProjectPlan` without `projects.viewMargin`.
- `/code-review` and `/security-review` before merging.

**Manual (`bun run dev`, then `bun run db:seed` for fresh data)**
1. **Standalone create** — `/projects` → Add project: billing type required; fixed fee requires amount + currency; T&M prefills five rows at 225 USD; change one row's currency → warning appears and submit still succeeds.
2. **Opportunity create** — open an opportunity with no project → Project plan tab → Create project now opens the budget dialog; verify the created project carries the budget.
3. **Board drag** — drag an opportunity with no project into a delivery stage: the budget dialog appears; **cancel** → card returns to its origin column; **submit** → the stage move completes.
4. **Summary + margin** — on a seeded T&M project (opportunity tab and `/projects/[id]`): revenue = Σ(hours × rate); assign a person to an open role and confirm the row's cost changes from the company average to that person's own figure, and the tooltip label changes with it.
5. **FX** — toggle CAD ↔ USD: warning icons appear only on converted figures, and the tooltip names today's `asOf` date. Temporarily point `FRANKFURTER_URL` at an unreachable host to confirm the `stale` copy.
6. **Permission masking** — via `/admin` users, set your role to `sales`, reload the opportunity's Project-plan tab, and confirm **no cost or margin renders and none is present in the network payload**. Then `delivery-manager` → margin visible. Then `user` → revenue only.
7. **Edge states** — a seeded no-budget project shows "No budget set" + Set budget; a plan with zero roles shows `—`, not 0% or NaN.
