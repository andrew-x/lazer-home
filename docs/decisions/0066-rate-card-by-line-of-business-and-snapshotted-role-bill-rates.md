# 0066 — A rate card keyed by line of business × discipline, snapshotted onto each role as an editable bill rate

**Status:** accepted · 2026-08-04 · **supersedes [ADR 0053](./0053-project-budgets-and-margin.md) §1–2 in part.**
0053 §1 rejected `project_roles.hourlyRate` by name and §2 established one code-owned card
as the only place a rate lives. The card stays in code, but it gains a second key, and a
rate now *is* stored per role. 0053's rejection text is left intact — it asked for this to
be reopened "as a schema decision, deliberately", and the reasoning it recorded is what this
ADR has to answer rather than delete. Everything in 0053 §3–§9 still holds unchanged.

## Context

0053 gave a project a billing model and a single rate card: `BILL_RATES`, a **total**
`Record<ProjectRoleType, number>` at a flat 225 USD placeholder, consulted live by
`computeProjectMargin`. Two things it couldn't express turned out to matter.

**Pricing doesn't vary by practice.** `project_roles.lineOfBusiness` has been `not null`
since [ADR 0033](./0033-line-of-business-on-role-derived-project-status.md), but nothing
read it for money — a Fintech architect and a Corporate architect billed identically with
no way to say otherwise.

**A negotiated rate had nowhere to live.** Real engagements discount and premium off the
card. A fixed-fee project showed its fee with no way to see how that fee compared to what
the work is worth at standard rates, which is the question that makes a fee reviewable
rather than merely recorded.

## Decision

### 1. The card is keyed `(lineOfBusiness, roleType)`, `Partial` in both dimensions

`src/lib/projects/bill-rates.ts` becomes `DEFAULT_BILL_RATE = 250` plus
`BILL_RATE_EXCEPTIONS` — only cells that *deviate* — resolved by
**`billRateFor({ lineOfBusiness, roleType })`**, the sole sanctioned reader of the map.
`BILL_RATES` and `isFlatRateCard()` are **deleted** rather than redefined: after the reshape
the map holds deviations, not rates, so `BILL_RATES[x]` would have been a lie, and deleting
it made the compiler name all three call sites. `exceptions.length === 0` now expresses "one
flat rate" structurally, so the second way of asking that question is gone.

A total map over both keys would be 5 × 6 = 30 hand-maintained cells, almost all identical —
the same argument `isFlatRateCard()` already made about printing five identical rows, one
dimension up. It also ships **empty**: the figures are still a placeholder, and a fabricated
exception would read as a pricing decision nobody made.

**The cost, stated plainly: totality moved from the type checker to a `??`.** 0053's
Consequences claimed "a role type with no bill rate is unrepresentable **because the map is
total**". The property survives — `billRateFor` cannot return `undefined` — but adding a
`LineOfBusiness` or `ProjectRoleType` **no longer breaks the build**; it silently prices at
the default. `DELIVERY` (§3) was the first instance. This is only safe because the default is
a real price and never a zero, and the loop over all 30 pairs in `project-margin.test.ts` is
what's left of the compile-time pressure.

### 2. Each role stores its own bill rate, **snapshotted** at creation

`project_roles.billRate` — `numeric(12, 2)`, **NOT NULL, no DB default**, with a
`project_roles_bill_rate_positive` check. It is seeded from `billRateFor` when the role is
created and editable afterwards. **Revising the card prices future roles and deliberately
does not re-price existing ones.**

That reverses 0053's Consequence that "revising `BILL_RATES` re-prices **every** T&M
project's plan, retroactively… a past margin can't be reconstructed." Both halves flip: a
plan's revenue is now reproducible from its own rows, and a price change can't silently move
historical figures.

Answering 0053 §1's two objections directly:

- **"A bill rate is a price for a discipline, not a property of one line."** Still true, and
  the card is still the only place a discipline's price is *decided*. The column is a
  snapshot of that decision plus any negotiated deviation — not a competing pricing policy.
- **"A rate would silently travel with a copy and drift from its siblings."** It does travel
  (§4), but not *silently*: every rate that differs from the current card is flagged in the
  UI (§6).

**No DB default is load-bearing.** A default would put 250 in a second home, ignore exception
cells, and silently paper over a write path that forgot to snapshot. With none, such a path
fails loudly.

**This is a snapshot, not effective-dating.** [ADR 0007](./0007-staff-employment-effective-dating.md)'s
pattern is *not* adopted: editing a rate overwrites it, and there is still no per-role rate
*history*. An override is as retroactive as the card used to be.

### 3. `DELIVERY` is a sixth discipline

`PROJECT_ROLE_TYPES` gains `DELIVERY` (appended last, matching where
`ALTER TYPE … ADD VALUE` puts it in Postgres's sort order), so delivery time can be planned
and priced like any other line.

This also closes a latent gap: the staff role `DELIVERY` is billable (`isBillableRole`) but
no project role type mapped to it, so `getRoleTypeAverageCostsUsd` could never cost an open
delivery role. Now five of six map 1:1 and only `SPECIALIST` stays `null`. **SPECIALIST's
figure does not move** — DELIVERY salaries were already inside its billable fallback pool;
DELIVERY simply gains its own bucket.

Worth recording as evidence the [ADR 0016](./0016-junction-table-and-shared-enum-conventions.md)
convention paid off: this was **three source lines and one migration, with zero UI edits.**
Every filter, form and label reads the shared tuple and label map, so exactly two exhaustive
`Record<ProjectRoleType, …>` maps needed touching.

> **Overtaken the same day by [ADR 0069](./0069-delivery-managers-as-project-roles-and-coverage-gaps.md).**
> This section originally read: "`project_delivery_managers` is **unchanged and unrelated**. A
> delivery *role* is a billable plan line with dates, hours and a rate; the junction names who
> owns the engagement and carries none of those. One person can be both." That distinction is
> now **backwards** — the junction was dropped and a `DELIVERY` role *is* the delivery manager.
> The reasoning above for *adding* the discipline stands untouched; what changed is that adding
> it turned out to make the junction redundant rather than complementary, which is why the
> hours-and-rate consequence §3 treated as incidental became load-bearing (0069 §7: delivery
> time now moves revenue, margin, capacity and utilization).

### 4. Duplicate and Extend carry the rate; Assign and Bump don't touch it

`duplicateProjectRoles` already declares its one deliberate omission (`staffId: null` —
"copy the shape, not the person"), and a negotiated price **is** part of the shape.
`extendProjectRole` is explicitly "a continuation", and re-pricing a continuation at today's
card would not be one.

The asymmetry with 0053's fear is the point: under NOT NULL the alternative to carrying the
rate is *re-snapshotting at today's card*, which is a silent renegotiation — strictly worse
than a travelling rate that every row visibly flags.

The other four writers leave it alone, each because it sets a deliberate column subset:
`assignRoleStaff` (`staffId` — putting a person into an off-card open role must not reset its
price), `bumpProjectRoles` (dates), `confirmRolesOnWon` (`status`) and `allocateStaffToRole`
(staff, dates, hours). **`createProjectFromOpportunity` and `loadOpportunityPlan` insert no
roles at all.** The full list is enumerated here because the column is NOT NULL with no
default: a writer that forgot the rate would be a runtime failure, so "which sites touch
`project_roles`" is now a fact worth being able to check without re-deriving it.

### 5. One shared transform fills the rate, not five fallbacks

`snapshotBillRate` is a `.transform()` on `projectRoleSchema` and the four composed role
schemas, so `billRate` is a plain `number` in every schema's *output* type and the type
checker does the remembering. With five insert paths, two update paths and no DB default, a
single forgotten `?? billRateFor(...)` would have been a 500 — this is the same "one rule,
every role schema" reasoning as `endOnOrAfterStart`.

The field itself needed a new primitive, `optionalMoney` in `src/lib/schemas/money-schema.ts`
(which also gives `MAX_MONEY` one home instead of two). `z.coerce.number()` maps `""` to `0`
and `.positive()` *rejects* it, so a plainly-optional amount would error instead of coming
through absent. This is the **mirror image** of `projectBudget.schema.ts`, where `.positive()`
is load-bearing precisely so a blank fee *fails* rather than saving $0 — same coercion,
opposite intent, which is why it's a named primitive rather than an inline chain that reads
like a copy-paste slip.

### 6. "Off standard rate" is **derived**, and deliberately conflates two causes

`isOffStandardRate(role)` compares the stored rate to `billRateFor(role)`. There is **no
`rateIsCustom` provenance column**, so the marker is true both when someone negotiated a
different rate *and* when the card has since moved and the role still carries the old price.

That conflation is the design, not a compromise. Snapshotting makes **stale prices** the new
failure mode of the whole system, and this is the only instrument that surfaces them. "Who
typed this" is not actionable; "this bills differently from the current card" is — you clear
the field. Hence the label is "off standard rate", never "overridden".

This is not the per-value provenance system 0053 §8 built and deleted, and it clears that
section's own three objections: it **names its reference** in the tooltip (0053's told you
"converted" without saying at what rate); it appears **only on the exception**, and the one
case where it lights up every row *is itself the finding*; and it is **derived at render**
from two values already on screen, so there is nothing to rot.

A `rateIsCustom` column would have been actively worse: it answers the unactionable question
while leaving the actionable one open (so you'd render both markers — the noise 0053 §8
rejected), it needs bookkeeping at nine write sites where any single omission yields a *lying*
column, and it duplicates something derivable.

**Deferred, don't build:** to separate stale from deliberate later, the honest instrument is
not a boolean but `project_roles.createdAt` (already there) compared against
`BILL_RATES_REVIEWED_ON`. Derivable, no migration, and probabilistic — which is why it isn't
being decided now.

Comparison is on **rounded cents**, not floats: a `numeric(12, 2)` round trip means a card
figure of `333.333` would store as `333.33`, and a role priced from that very cell would
otherwise read as off-card forever. The card's docstring accordingly requires ≤2 decimals.

### 7. Fixed fee gains a comparator; §5's ban on apportioning stands

`BudgetTotals` gains `hourlyValue` / `hourlyValueDelta` / `hourlyValueDeltaPercent`,
non-null **iff** `billingType === "FIXED_FEE"` and the fee is set (the percent additionally
needs a positive denominator, reusing `marginOf`'s existing zero rule rather than inventing a
second one).

**It is built from the roles' own rates, not from a live card lookup.** Under snapshots
there is no "rate card value" for a plan: a card-derived comparator would move under the
reader's feet on every revision — reintroducing exactly the retroactive behaviour §2
removed — and it would make the two billing models use *different arithmetic*. As built, the
T&M revenue expression and the fixed-fee comparator are literally the same expression, which
is what lets the panel claim they're comparable.

**0053 §5 is unamended: per-role `revenue` is still `null` on a fixed fee.** A per-role
*hourly value* is deliberately absent too — it's one `.reduce()` from the apportionment §5
refused, and "$40k" on a fixed-fee row reads as that role's revenue. But `RoleMargin.billRate`
**is** non-null there: a rate can't be summed into a fee the way an amount can. That's the
line — a rate is safe to expose per row where an amount would not be — and the field is what
`hourlyValue` accumulates from, in display currency like every other figure on that type.

Note the marker in §6 does **not** read `RoleMargin.billRate`. It can't: that value is
display-converted, and the comparison has to happen in `BILL_RATE_CURRENCY` against the card.
It also has to work on a project with *no* billing model, where `computeProjectMargin` resolves
no rate at all. So the UI reads the rate off the plan payload and `RoleMargin.billRate` stays
the money layer's own view of it. Feeding a converted rate to `isOffStandardRate` would flag
every role on any non-USD panel.

**The delta is uncoloured.** A discount is a negotiation, not a loss; this codebase colours
only losses and has no success token, so a premium couldn't be green either. Margin keeps the
sole tone on that panel. Recording this as a decision because it otherwise looks like an
oversight someone should "fix".

It renders **outside** the `margin.includesCost` branch — the comparator is revenue-side, so a
viewer without `projects.viewMargin` sees it — and it does **not** inherit the cost-side
caveats: `unknownCostRoleCount` / `openRoleCount` are about cost, and a plan of entirely open
roles has a *complete* hourly value.

### 8. Rate resolution stays client-side, and the math stops reading the card entirely

`computeProjectMargin` now imports only `BILL_RATE_CURRENCY`. Rates arrive on the rows, so
0053's documented "takes no rate-card argument" guarantee becomes *more* true — and under
snapshots, putting a `billRateFor` lookup back into the math would silently re-price
historical plans. That is now a bug, not an optimization.

`MarginRoleInput` therefore gains `billRate` and needs **no** `lineOfBusiness`: the card's
second key is none of the math's business. Only the UI resolves the card, on the client.

**[ADR 0057](./0057-projects-list-margin-and-derived-flags.md)'s server-side precomputation
does not transfer.** Its stated reason is that no individual's compensation-derived hourly
cost may reach the browser. A bill rate is commercial, not personal — that is 0053 §7's whole
asymmetry — and `budget-fields.tsx` has always been a `"use client"` importer of the card
anyway.

### 9. No new capability, and no matrix change

Writes ride the existing `projects.edit`; reads are ungated like the rest of revenue.
`permissions.ts`, `permissions.test.ts` and `docs/domains/permissions.md` are **untouched**.

Stated explicitly so a future `/audit-rbac` reader doesn't take the omission for an oversight:
per 0053 §7, cost is gated because a role's cost *is* an individual's compensation. A bill
rate is a commercial term about an engagement. `sales` can already see revenue via
`loadOpportunityPlan` (`crm.edit`) and can therefore set a rate on an opportunity's plan
roles — consistent with that model, and worth knowing rather than discovering.

## Consequences

- **A fixed-fee panel now legitimately claims an FX conversion.** Because the comparator
  applies the roles' USD rates, a fixed-fee plan displayed in CAD adds `"USD"` to
  `convertedFrom` and grows an `FxRateNote` where it had none. That's correct — a USD-derived
  figure is on screen — and it reverses a shipped test, now split into the USD and CAD cases.
  The conversion is gated on `billingType != null` so a no-budget project can't claim a
  conversion it never displayed.
- **The discount percentage is FX-sensitive.** `resolveDisplayCurrency` opens a CAD fee in
  CAD, so a CAD fee against USD rates means "12% discount" drifts with the exchange rate at
  zero commercial change. Both sides are shown in one currency so the figure is internally
  consistent, but the *ratio* is rate-dependent. Not fixable inside §8's
  one-currency-per-panel rule.
- **`/projects` risk flags will shift.** `project-flags.ts` thresholds are unchanged while
  their inputs move, so a project can flip in or out of "Low margin" purely from an
  off-card rate. Separately, the list uses list-scoped `nativeCurrencies` rather than
  `convertedFrom`, so the FX consequence above is invisible there and
  `getProjectsMarginContext.ts` needed no change — noted because it looks like it should have.
- **Off-card rates on a `billingType: null` project are legal and invisible in money.** The
  Roles tab shows a rate on a project whose panel says "No budget set", because the rate is a
  property of the role. Intended; the tooltip carries it.
- **The create-project dialog can't set a rate** — `add-project-dialog.tsx` collects no roles,
  so every role born there snapshots the card and a nonstandard price is a second step in the
  planner. The roles array in `createProjectSchema` carries `billRate` regardless, so a future
  caller can't silently drop it.
- **A future *partial* role update would silently re-snapshot.** Both update schemas are
  full-object writes today, so an absent rate unambiguously means "re-snapshot from the card".
  Under a `saveCompensationPlanItem`-style patch it would re-price a role whose rate the
  caller simply didn't send. Noted in `snapshotBillRate`'s docstring.
- **`billRateFor`'s structural argument accepts an `ExternalAllocation`** — it has both keys.
  `ExternalAllocation` deliberately carries no `billRate` (another project's role is never
  priced on this planner) and says so in a comment, because nothing else prevents it.
- **`project-margin.test.ts` grew from 22 to 35 tests**, still the sanctioned
  [ADR 0037](./0037-unit-tests-removed-except-rbac-matrix.md) exception. `billRateFor` and
  `rateCardSummary` are covered *there* rather than in a new `bill-rates.test.ts`, so no new
  exception had to be argued.
- **The seed gives ~15% of roles an off-card rate.** Deliberately low: an off-card rate is the
  exception, and seeding half of them would make the subtle marker the norm and hide the
  design it exists to express.
