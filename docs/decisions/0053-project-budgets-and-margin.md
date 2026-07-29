# 0053 — Project budgets & margin: billing model on the project, one code-owned rate card, cost gated apart from revenue

**Status:** accepted · 2026-07-29 · **renumbered, and §1–2 reversed before merge.** Filed as
0052, which collided with
[ADR 0052](./0052-contact-relationships-one-typed-junction.md) landing on `main` — the trunk
number won, as it did twice for
[ADR 0051](./0051-plan-editor-status-ladder-display-units-and-level-targets.md). Nothing
outside `/docs` linked to the old number. A per-project rate-card table
(`project_role_rates`) was built and migrated, then dropped before shipping in favour of a
single card in code; the create-then-drop migration pair was **collapsed into one
`drizzle/0016_violet_whistler.sql`** when this branch merged `main`, so the rejected table
leaves no trace in the schema history. The reasoning is recorded below rather than deleted,
because the rejected shape is the obvious one to re-propose.

## Context

Until now a project carried **no commercial information at all** — name, company,
timestamps, and its roles ([ADR 0033](./0033-line-of-business-on-role-derived-project-status.md)
even took `status` and `lineOfBusiness` away). `docs/domains/projects.md` closed with
"no budget/value, no rates", and `data-model.md` listed **Margin** as a derived concept
nobody could compute: *(charge rate − cost rate) × billable hours*.

Both halves of that formula were already in the database, unconnected. The **cost** side
has been there since [ADR 0020](./0020-compensation-effective-dated-import-only.md):
`staff_employment` carries each person's `base`/`hourlyRate` + `currency`. The **hours**
side is `project_roles` (dates × `hoursPerDay` — [ADR 0017](./0017-project-roles-as-first-allocation-cut.md)).
Only the **price** was missing, and with it any answer to "is this engagement
profitable?" — the question a delivery manager staffing a plan most wants answered
*while* staffing it, not a quarter later.

Joining those three is the projects domain's **first contact with compensation**, which
makes this as much a privacy decision as a modelling one.

## Decision

### 1. Only the billing model and the fee are stored; the rate card is not per project

Two structurally different models, not two flavours of one shape:

- **`FIXED_FEE`** — one total for the whole engagement: `projects.budgetAmount` +
  `budgetCurrency`.
- **`TIME_AND_MATERIALS`** — **nothing stored at all.** It bills hours at the company's
  one standard rate card, which lives in code (§2).

`projects.billingType` (a new `project_billing_type` pgEnum, values from the pure
`src/lib/projects/project-billing.ts` per [ADR 0016](./0016-junction-table-and-shared-enum-conventions.md))
is the discriminant, and all three columns are **nullable** — see §6.

The either/or is enforced **at every layer**: a `check("projects_budget_shape")`
constraint in the DB, a zod **discriminated union** in `projectBudget.schema.ts`, and a
branch in the form. A T&M project carrying a total is therefore *unrepresentable* rather
than merely invalid — and the union means the action bodies `switch` on `billingType` with
each half already narrowed, instead of re-validating by hand. The T&M arm is literally
`z.object({ billingType: z.literal("TIME_AND_MATERIALS") })`: **picking the billing type
is the entire decision.**

**Rejected: one rate per staffing line** (`project_roles.hourlyRate`). A bill rate is a
price for a **discipline**, not a property of one line. Putting it on the row would mean
re-typing it on every duplicated, extended, or re-dated role — and
`duplicateProjectRoles`/`extendProjectRole` copy role *shape*, so a rate would silently
travel with a copy and then drift from its siblings.

**Rejected: a per-project rate card** (`project_role_rates`, one row per
`(projectId, roleType)`). **This was built, migrated and then removed before shipping** —
see §2 for why, and *Consequences* for what the removal bought. It was carried for a while
as an honest create-then-drop pair (`0014` created the table, `0015` dropped it with
`DROP TABLE ... CASCADE`) rather than editing a migration in place and lying to
`__drizzle_migrations`. That pair **never left the branch**: merging `main` renumbered these
migrations anyway, so the two were regenerated as a single
**`drizzle/0016_violet_whistler.sql`** carrying only the surviving columns. The table exists
in no migration now — this ADR is the only record that it was tried.

### 2. There is exactly ONE rate card, and it lives in code

`src/lib/projects/bill-rates.ts` is the whole story: **`BILL_RATES`** (a **total** map over
`PROJECT_ROLE_TYPES` — every discipline must have a rate), `BILL_RATE_CURRENCY` (one
currency for the whole card), `BILL_RATES_REVIEWED_ON`, plus `standardRateCard()` for
display and `isFlatRateCard()` so the form can say "225/hr for every discipline" in one
line rather than listing five identical rows.

A rate card is **policy**: we charge a discipline what we charge it, revised periodically
by human judgement — it is not negotiated engagement by engagement. So there is nothing
per-project to store, and storing it per project would have been actively harmful: it
invites two projects **silently disagreeing about what an engineer-hour is worth**, with
no product benefit, no UI that ever wanted to diverge them, and a per-project copy that
goes stale the moment the real card is revised. Keeping it in code means a rate change is a
code review rather than a migration, it's readable straight from the create dialog, and
it's versioned alongside the math that interprets it — the precedent set by
`@/lib/performance/compensation-targets` and the rating rubrics
([ADR 0042](./0042-per-role-subratings-app-owned-jsonb.md)).

The form therefore shows the card **read-only** (a `StandardRateCard` panel built from
`BILL_RATES`, so a rate revision surfaces without anyone touching the form) rather than as
five editable rows. Showing it at all is the point: it's what makes "time & materials" a
*priced* choice rather than a blank cheque.

⚠️ **The shipped figures are a flat 225 USD placeholder across all five disciplines** —
structurally correct, not a pricing decision. Replace them (and bump
`BILL_RATES_REVIEWED_ON`) before anyone reads a project's revenue as authoritative.

**If per-project pricing is ever genuinely needed, reopen this as a schema decision** —
don't bolt a field onto that map.

### 3. Hours come from real weekdays, never from the planner grid

`roleBillableHours` = `countWorkingDays(start, end) × hoursPerDay`, reusing the PTO
module's Mon–Fri math (`src/lib/staff/pto-working-days.ts`).

**Deliberately NOT the grids' `weekPercent`/`bucketPercent`.** Per
[ADR 0040](./0040-allocations-planner-granularity.md) a planner column shows the role's
**flat nominal rate** at every zoom — a month column is *not* prorated by the working days
it covers. A grid percentage is therefore a **rate, never a quantity**, and money derived
from one would be wrong by whole weeks at month granularity while looking plausible. The
grid and the money share the roles, not the arithmetic.

Statutory holidays aren't modelled (there's no holiday calendar), so hours are a slight
overstatement — **symmetrically on both revenue and cost**, which is why it was
acceptable to ship.

### 4. Only `cancelled` is excluded; PTO is deliberately ignored

`countsTowardBudget(status)` = everything except `cancelled`. Cancelled work will never be
delivered or billed; `paused` is expected to resume on the dates it still carries. This is
**not** the allocations grid's `["tentative","confirmed"]` filter, which answers a
different question (whose capacity is committed *right now*).

**Leave is not netted off hours**, even though `staff_pto` is right there and
`getProjectPto` already reads it per project. Three reasons: leave shifts constantly and is
partly still pending; a salaried person's cost accrues while they're away; so subtracting
leave would move **revenue without moving cost** and swing the margin for a
non-commercial reason. Leave stays visible on the project's own Time-off tab, where it
informs *scheduling* rather than pricing.

### 5. Fixed-fee margin exists only at the project level

A T&M project prices each discipline by the hour, so revenue is attributable per role and
every row gets a real margin. A fixed fee is **one price for the whole engagement**:
apportioning it across roles (pro-rata by hours? by cost? by rate card?) would invent a
number that reads like a fact. So on a fixed-fee plan **per-role `revenue` is `null`** —
rows still show hours and cost — and the margin appears only in the summary
panel, where it is true.

Relatedly, `marginPercent` is **null whenever revenue is 0**, so an empty plan reports "—"
instead of a triumphant 100%.

**Where margin *is* shown, the money leads and the percentage supports it** — in the panel
the amount is the figure with the percentage as its hint line, and the planner's per-role
line matches (`CA$8,000 margin`, percentage in the tooltip). What an engagement earns is the
decision being made; the rate is how to read it, not the thing itself. That split needs
**two tone helpers at different precisions**: `marginTone` rounds a percentage to one
decimal, `marginAmountTone` rounds an amount to **whole dollars**, because that is how
`aggregateMoneyFormatters` renders it — a −$0.30 margin displays as "CA$0", and colouring a
figure that reads as zero would be a lie about what's on screen.

### 6. `billingType: null` is a permanent, meaningful state

Every project created before this change genuinely has no budget, and the UI says exactly
that ("No budget set") rather than inventing a zero — the same "no target ≠ a target of
nothing" rule as `compTargetAnnual`. The check constraint's first branch (all three null)
is satisfied by every pre-existing row, so **the migration needed no backfill**. Budget is
**required going forward** in `createProjectSchema` and
`createProjectFromOpportunitySchema`, and `updateProjectBudget` is how an old project
acquires one.

### 7. A new read capability — `projects.viewMargin` — and masking lives in the read

Cost and margin are gated on a **new** `projects.viewMargin`, granted to `admin`,
`manager`, `finance` and `delivery-manager`. **Revenue is not gated at all.**

The asymmetry is the whole point: a role's cost **is an individual's compensation** (their
pay ÷ `HOURS_PER_YEAR`), so on a one-role project even the "aggregate" discloses a salary,
and the open-role figure is a per-discipline comp average — the same bulk exposure
`getCompensationSummaryData` gates. A fee or a rate card is commercial, not personal.

**Rejected: riding on `projects.edit`.** That capability staffs a plan; `delivery-manager`
holds it and does need margin, but `finance` needs margin **without** the ability to edit
projects, and the ability to move a role must not imply the right to read someone's
salary. Two orthogonal questions, two capabilities.

**Rejected: hiding cost in the UI.** `src/actions/projects/getProjectCostBasis.ts` is the
**single decision point** and it returns `null` — the absence of the numbers *is* the
signal — **before touching `staff_employment` at all**. This has to happen in the read
because both plan readers ship to client components: `getProjectPlan` SSRs into
`ProjectDetailView`, and `loadOpportunityPlan` is gated only on **`crm.edit`**, so `sales`
legitimately reaches an opportunity's Project-plan tab. A client-side filter there would
put compensation-derived numbers in a payload that merely declines to render them. It
**masks rather than throws** (like `getProjectPto`'s leave type) because the plan is the
whole page.

Open-role cost is a **company-wide average per discipline, computed in USD server-side**,
so the client's currency toggle needs no re-read *and* no individual amount ever leaves the
server. `SPECIALIST` has no `staff_employment.role` counterpart
(`STAFF_ROLE_FOR_PROJECT_ROLE_TYPE` maps it to `null`), so it averages every *billable*
discipline — an approximation by construction, which is why every cost carries a
`RoleCostBasis` (`PERSON` / `ROLE_AVERAGE` / `UNKNOWN` / `HIDDEN`) that the UI surfaces. A
role type with **no matching staff is absent from the averages map, never 0**: "we have no
basis" and "this is free" are different claims and only one is safe in a margin.

### 8. The FX caveat is stated once, beside the selector, and names the rates

A panel's figures can still be denominated differently — a fixed fee in CAD, the rate card
in USD, a person's compensation in either — so conversion needs surfacing **once, beside
the currency selector that causes it, naming the rates used**.
`ProjectMargin.convertedFrom` carries the distinct currencies a rate was *actually applied
to* (in canonical `CURRENCY` order, collected by an internal `noteConversion(from)` that
no-ops when `from` is already the display currency, so a USD figure displayed in USD
is never claimed as converted), and `src/components/fx-rate-note.tsx` renders it: one
currency inline (`1 USD = 1.37 CAD`), several as "Converted at today's rates" with the pairs
in the tooltip, always closing with the `asOf` date or the stale-fallback sentence, and
**nothing at all** when no conversion happened.

(The **mixed-currency case is gone** with the per-project card: one card, one
`BILL_RATE_CURRENCY`. Both the form's and the panel's mixed-currency notices, and
`mixedRateCurrencies`, were deleted with it. `resolveDisplayCurrency` correspondingly takes
only `{ budgetCurrency }` and falls back to the card's currency, then USD.)

**Rejected: a per-value provenance system.** This was built first — an `FxAmount` +
`convertTagged` + `sumFx` trio in `fx.ts` tagging each amount with `converted`, propagated
through aggregation, rendered as a warning icon next to every affected figure — and then
**deleted**. Two reasons. It answered the wrong question: "this was converted" is only half
the information, and a reader who can't see the *rate* can neither reproduce the figure nor
judge how much to trust it. And it doesn't scale down gracefully — on a mixed-currency plan
nearly every figure earns an icon, at which point the marker distinguishes nothing and is
pure noise. A per-panel statement is both more informative and quieter. `fx.ts` is
consequently back to `AED_PER_USD` + `FALLBACK_USD_RATES` + `convert()`, `RoleMargin`/
`BudgetTotals` carry plain `number | null` amounts, and `PlannerMargins` has no `rates`
field — **don't reintroduce per-value tagging**; a system nothing consumes rots.

Rates come from the
existing `getExchangeRates()` ([ADR 0029](./0029-external-fx-rates-and-currency-normalization.md));
conversion happens **on the client** from native amounts + the shipped rate table, so
toggling CAD/USD never refetches — and the same table lets `FxRateNote` compute the pair
rates it displays.

### 9. Margin renders as a third line in the planner's label cell, not a new column

`PlannerGrid` takes one optional `margins` prop. A new lead column was rejected on a
concrete constraint: `PLANNER_SUB_LABEL_COL`'s `sticky left-56` is **hand-twinned** to
`PLANNER_LABEL_COL`, and those widths are shared with the allocations grid — a third
sticky column would shift the week spine on every planner in the app.

## Consequences

- **The projects domain now reads `staff_employment`.** `src/actions/shared/staffHourlyCost.ts`
  is the only place it does, and everything it produces is compensation-derived: no caller
  may ship its output without `projects.viewMargin`. Route it through
  `getProjectCostBasis`, never call it directly.
- **Salary restatement uses the flat `HOURS_PER_YEAR` convention** (`convertCompUnit`, the
  same transform the compensation editor's annual/hourly toggle uses), **not**
  `utilizationTarget` — so the same salary always yields the same hourly cost and a
  project's margin doesn't move when someone's utilization target is revised. Bonuses are
  excluded: `base` is the committed number.
- **Creating a project from an opportunity is no longer one-click.** Both entry points (the
  Project-plan tab's empty state and the board's delivery-stage drag prompt, which replaced
  its `ConfirmDialog`) now open a dialog asking how the work bills. Deliberate friction:
  a project born without a budget is a project nobody prices later.
- **Dropping the per-project card simplified four layers at once**, which is the clearest
  argument that it was the wrong shape: the write path lost `writeProjectRateCard` (nothing
  to reconcile) and with it `updateProjectBudget`'s **transaction** — it's now a single
  `UPDATE ... RETURNING`, using the returned-nothing case as its not-found error instead of a
  separate `assertRowExists` pre-read; the zod T&M arm lost all input; both plan readers lost
  `readRateCard` and `PlanBudget.rateCard` (and `getProjectPlan` its `Promise.all`); and
  `computeProjectMargin` lost its `rateCard` parameter, `RateCardRow`, `mixedRateCurrencies`,
  `ProjectMargin.mixedCurrencies` and `ProjectMargin.unpricedRoleCount`. That last one is the
  prize: because `BILL_RATES` is **total** over `ProjectRoleType`, **"a role type with no bill
  rate" is now unrepresentable** rather than a partial-revenue state the UI had to warn about.
- **`updateProjectBudget` is still separate from `updateProject`** so renaming a project
  doesn't also re-submit its price — the last-write-wins clobbering `updateProjectField`
  exists to avoid.
- **No rate history — and now it's global.** Revising `BILL_RATES` re-prices **every** T&M
  project's plan, retroactively, because revenue is always computed from the current card.
  For a forward-looking planning figure that's the desired behaviour (one card, one truth),
  but it means a past margin can't be reconstructed — the same limitation as `project_roles`
  ([ADR 0017](./0017-project-roles-as-first-allocation-cut.md)). If billing ever needs
  invoice-accurate history, the card needs dating (effective-from rows), which is a
  deliberate reopening of §1–2, not a field to add
  ([ADR 0007](./0007-staff-employment-effective-dating.md) is the pattern).
- **This is a *plan* margin, not an actual.** It costs the allocation, not the logged time
  — `time_entries` are untouched. Forecast-vs-actual reconciliation is still unbuilt and
  is now the obvious next step.
- **`project-margin.test.ts` (22 tests)** is another sanctioned exception to
  [ADR 0037](./0037-unit-tests-removed-except-rbac-matrix.md), on the same grounds as
  `compensation-plan.test.ts`: money math whose edge cases (null revenue, absent cost basis,
  and `convertedFrom` claiming exactly the currencies a rate was applied to — including the
  empty case) the type system can't express.
- **The RBAC matrix grew a column.** `permissions.ts`, `permissions.test.ts`, and
  `docs/domains/permissions.md` were updated in lockstep, as that rule requires.
