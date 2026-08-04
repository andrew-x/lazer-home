# Rate card per line of business × billable role, with per-role bill-rate overrides

## Context

A project's revenue is priced today by **one code-owned rate card keyed on discipline alone** —
`src/lib/projects/bill-rates.ts`, a total `Record<ProjectRoleType, number>` sitting at a flat `225`
USD placeholder. `computeProjectMargin` prices a T&M role as `hours × BILL_RATES[roleType]`; a
fixed-fee project ignores the card entirely and reports its stored fee as revenue.

Two gaps:

1. **Pricing doesn't vary by practice.** Line of business is already on every staffing line
   (`project_roles.lineOfBusiness`, not null) but nothing reads it for money — a Fintech architect
   and a Corporate architect bill identically, with no way to say otherwise.
2. **A negotiated rate has nowhere to live.** Real engagements discount and premium off the card,
   and today that's invisible: a fixed-fee project shows its fee with no way to see how it compares
   to what the work is worth at standard rates.

This change keys the card on **(line of business, billable role)** with a **$250/hr USD default**
and exceptions in code; snapshots that rate onto each project role at creation as an overridable
**bill rate**; flags any rate that's off the card with a subtle indicator; and on fixed-fee projects
shows the plan's rate-card value beside the fee with the **discount/premium** between them.

### Decisions taken (confirmed with you)

| Question | Decision |
|---|---|
| What does the role store? | The **bill rate** only. Internal cost stays derived from compensation via `staffHourlyCost.ts`; the `projects.viewMargin` split is untouched. |
| Delivery manager | **Add `DELIVERY`** to `PROJECT_ROLE_TYPES` / the `project_role_type` pgEnum — six disciplines. |
| Inheritance | **Snapshot at creation.** The column is `NOT NULL`, seeded from the card when the role is created; a later card revision does not reach it. |
| Copy semantics | `duplicateProjectRoles` / `extendProjectRole` **carry the rate** through. |

**No RBAC change.** A bill rate is commercial, not compensation-derived (ADR 0053 §7's asymmetry),
so it stays ungated on read and rides the existing `projects.edit` gate on write.
`permissions.ts`, `permissions.test.ts` and `docs/domains/permissions.md` are **not touched** — and
the new ADR must say so explicitly, so a future `/audit-rbac` doesn't read the omission as an
oversight.

### This deliberately reverses ADR 0053 §1

ADR 0053 rejected `project_roles.hourlyRate` — "a bill rate is a price for a **discipline**, not a
property of one line" — and rejected a per-project rate-card table it had built and dropped. It
also said: *"If per-project pricing is ever genuinely needed, reopen this as a schema decision."*
That's what this is. Its objections, answered honestly:

- **"A rate prices a discipline"** — still true. The card remains the only place a discipline's
  price is *decided*; the column is a snapshot of that decision plus any negotiated deviation, not
  a competing pricing policy.
- **"A rate would silently travel with a duplicate and drift from its siblings"** — it will travel
  (your decision), but not *silently*: every off-card rate carries a visible indicator.

Two further 0053 positions move and must be restated:

- **§2 "there is exactly ONE rate card, and it lives in code"** — still true. The card gains a
  dimension; it does not move into the database.
- **Consequence "revising `BILL_RATES` re-prices every T&M project's plan, retroactively"** —
  **no longer true.** Snapshot semantics mean a card revision reaches only roles created after it.

### One consequence of snapshot, stated plainly

Snapshot buys stability (a repricing can't silently move historical plans) and costs precision:
a stored rate that equals the card is indistinguishable from one deliberately set to that value,
and after a card revision a role still on the old price looks the same as a deliberate override.
The design leans into this rather than papering over it — the indicator is labelled **"off rate
card"**, which is true in both cases, and "which roles are still on the old price" is a question
worth being able to answer. The alternative (a `rateIsCustom` provenance column) is rejected:
ADR 0053 §8 killed a per-value provenance system as noise, and this would be a second one.

### Revisions made after approval

A second design pass verified details against the code and corrected the approved plan in five
places. Where these conflict with the sections below, **these win**:

1. **`createProjectFromOpportunity.ts` inserts no roles** — verified: its transaction inserts the
   `projects` row and links `opportunities.projectId`; roles are added afterwards in the planner.
   It is *not* a write site. `loadOpportunityPlan.ts` is a read and writes nothing. Both are named
   in the ADR as checked, since the conversion is the obvious place to suspect a missed snapshot.
2. **One migration for the column, following `drizzle/0002_gray_corsair.sql`** — add nullable →
   `UPDATE … SET bill_rate = 250` → `SET NOT NULL` → `ADD CONSTRAINT`, all transaction-safe in one
   file. **No DB default at any point**: a default would put 250 in a second home, ignore exception
   cells, and mask a write path that forgot to snapshot. (That precedent file also confirms Drizzle
   emits `ALTER TYPE … ADD VALUE` cleanly — `project_role_status` did exactly this.)
3. **A shared `snapshotBillRate` transform on the role schemas**, not five `?? billRateFor(...)`
   fallbacks in action bodies. Under `NOT NULL` a forgotten fallback is a 500, and
   `projectRole.schema.ts` already holds this kind of cross-schema rule (`endOnOrAfterStart`). The
   transform makes `billRate` a plain `number` in every parsed output, so the type checker replaces
   the five fallbacks.
4. **The blank-field coercion is inverted from the budget schema.** `z.coerce.number()` maps `""`
   to `0`, which `.positive()` *rejects* — so a blank rate would error instead of snapshotting.
   Needs `z.preprocess((v) => (v === "" || v == null ? undefined : v), …).optional()`. This is the
   mirror image of `projectBudget.schema.ts:30-32`, where `.positive()` is load-bearing precisely
   so a blank field fails rather than saving $0. Same coercion, opposite intent. It also gives a
   better gesture than dirty-tracking: **blank means "use today's card"**, so the placeholder
   previews the snapshot and clearing the field is how you fix a stale rate.
5. **Compare rounded cents, never floats.** `numeric(12,2)` truncates, so a card exception of
   `333.333` stores as `333.33` and a role snapshotted from that very card would read "off standard
   rate" forever. Require ≤2 decimals in the card, and compare
   `Math.round(a * 100) !== Math.round(b * 100)`.

Two naming refinements also adopted: the `BudgetTotals` fields are **`hourlyValue` /
`hourlyValueDelta` / `hourlyValueDeltaPercent`** (under snapshots there is no "rate card value" for
a plan — the roles may have drifted from the card), and the indicator reads **"off standard rate"**.

Verified while checking `DELIVERY`: exactly **three** exhaustive `Record<ProjectRoleType, …>` maps
exist — `PROJECT_ROLE_TYPE_LABELS`, `STAFF_ROLE_FOR_PROJECT_ROLE_TYPE`, and `BILL_RATES` (deleted
here, so it raises no error — the compiler-pressure loss lands on day one and belongs in the ADR).
Every other consumer is already `Partial`, and **no filter UI or form needs editing** — they all
read the shared tuple and label map. `isBillableRole("DELIVERY")` is already `true`, so DELIVERY
salaries were already inside the SPECIALIST fallback pool; this gives DELIVERY its own bucket
without moving SPECIALIST. Append `DELIVERY` **last** in the tuple, since `ALTER TYPE … ADD VALUE`
appends in Postgres's sort order.

---

## The design

### 1. Column name: `billRate`, not `hourlyRate`

`staff_employment.hourlyRate` (`src/lib/db/staff-schema.ts:183`) already exists — it is the **cost**
side of the margin, read by `staffHourlyCost.ts`. Naming the new column `hourlyRate` would put the
two opposite sides of the margin under one identifier inside the one domain that joins them, and
`MarginRoleInput` would carry `staffHourlyCost` and `hourlyRate` side by side. Use
**`project_roles.billRate`**, which also matches the existing `BILL_RATE_CURRENCY` /
`BILL_RATES_REVIEWED_ON` vocabulary. Free now, a second migration later.

### 2. `src/lib/projects/bill-rates.ts` — the card gains a dimension

| Export | Change |
|---|---|
| `BILL_RATE_CURRENCY` | unchanged (`"USD"`) |
| `BILL_RATES_REVIEWED_ON` | bump |
| `DEFAULT_BILL_RATE = 250` | new; replaces `FLAT_PLACEHOLDER_RATE`, keeps the ⚠️ PLACEHOLDER banner |
| `BILL_RATE_EXCEPTIONS` | new; `Partial<Record<LineOfBusiness, Partial<Record<ProjectRoleType, number>>>>` |
| `billRateFor({ lineOfBusiness, roleType }): number` | new; the **only** thing allowed to read the map |
| `rateCardSummary(): RateCardSummary` | replaces `standardRateCard()` |
| ~~`BILL_RATES`~~ | **deleted** |
| ~~`isFlatRateCard()`~~ | **deleted** |

- **Delete `BILL_RATES`, don't redefine it.** After the reshape the map holds *deviations*, not
  rates, so keeping the name would make `BILL_RATES[x]` a lie. Deleting it makes the compiler point
  at all three consumers (`project-margin.ts:263`, `budget-fields.tsx:235`,
  `project-margin.test.ts:56`) — that's the checklist.
- **`billRateFor` takes an object**, matching `compTargetAnnual` (`compensation-targets.ts:77`) and
  `roleBillableHours` (`project-margin.ts:126`), so a role can be passed structurally. Body is one
  line: `BILL_RATE_EXCEPTIONS[lineOfBusiness]?.[roleType] ?? DEFAULT_BILL_RATE`.
- **Drop `isFlatRateCard()`**: it existed only because the old return type couldn't express "all
  the same". `exceptions.length === 0` now expresses it structurally, and a second way to ask one
  question rots.
- `rateCardSummary()` returns `{ defaultRate, currency, exceptions: [...] }` where `exceptions`
  holds only deviating cells, built by iterating `LINE_OF_BUSINESS` then `PROJECT_ROLE_TYPES` —
  **not `Object.entries`** — so the panel reads identically every render, the same discipline as
  `convertedFrom`'s `CURRENCY.filter(...)` at `project-margin.ts:340`. A 5 × 6 matrix can't render
  in a `sm:max-w-lg` dialog, and `docs/ui.md` records that near-identical repeated markers were
  built and deleted as noise; the same argument kills 30 near-identical rows.
- **Ship `BILL_RATE_EXCEPTIONS` empty** unless you have real agreed cells. The figures are flagged
  `⚠️ PLACEHOLDER`; a fabricated exception is worse than a flat placeholder because it reads as a
  pricing decision. (Cost: the exceptions render path ships unexercised — covered by testing
  `rateCardSummary()` directly, see §9.)
- **The docstring must be honest about where totality went.** ADR 0053's Consequences claim "a role
  type with no bill rate is unrepresentable **because the map is total**". The property survives but
  its enforcement moves from the type checker to the `??` inside `billRateFor`. The accepted loss:
  **adding a `LineOfBusiness` or `ProjectRoleType` no longer breaks the build** — it silently prices
  at `DEFAULT_BILL_RATE`. Safe only because the default is a real price, never zero. That's a
  genuine regression in compiler pressure and belongs in the ADR, not buried in a comment.
- Note in the docstring that **value** imports of `line-of-business.ts` / `project-role-type.ts` are
  safe here (they are the sources the pgEnums read from) — unlike `compensation-targets.ts:32-35`,
  whose `import type`-only warning is about `staff-enums` reaching back into the schema. Otherwise
  someone copies the wrong caveat.
- The module stays pure and client-importable (no `db`/drizzle) — load-bearing, see §5.

### 3. Six disciplines

`src/lib/projects/project-role-type.ts`: add `DELIVERY` to `PROJECT_ROLE_TYPES`,
`PROJECT_ROLE_TYPE_LABELS` (`"Delivery"`), and `STAFF_ROLE_FOR_PROJECT_ROLE_TYPE`
(`DELIVERY: "DELIVERY"`). That last one closes a real gap: staff role `DELIVERY` is billable
(`isBillableRole`) but no project role type mapped to it, so `getRoleTypeAverageCostsUsd` could
never cost an open delivery role. Now it can, 1:1.

`project_delivery_managers` is **unchanged** — it answers "who owns this project", not "whose
delivery time is planned and billed". Both can be true of the same person; conflating them is out
of scope.

Every exhaustive `Record<ProjectRoleType, …>` fails to compile until updated — `bun run check`
enumerates them; don't hunt by hand.

### 4. Schema + migrations

`src/lib/db/projects-schema.ts`, `projectRoles`, after `hoursPerDay`:

```ts
// The hourly BILL rate for this staffing line — what the client is charged, never a
// cost (cost is never on a role; see getProjectCostBasis). Snapshotted from the
// code-owned card at creation, then editable: a card revision deliberately does NOT
// reach existing roles. Denominated in BILL_RATE_CURRENCY; there is no per-role
// currency column, so the FX story of ADR 0053 §8 is unchanged.
billRate: numeric({ precision: 12, scale: 2, mode: "number" }).notNull(),
```

Plus a check constraint alongside the two already in the file, so an import can't plant a free or
negative line:

```ts
check("project_roles_bill_rate_positive", sql`${t.billRate} > 0`)
```

Also fix the now-false prose **in the same file**: the header block at L36-38 and the `budgetAmount`
comment, both of which say a T&M project "has no stored rates".

**Two migrations, deliberately separate** — `ALTER TYPE … ADD VALUE` and a backfill that could
reference the new value must not share a transaction; splitting removes the question:

1. `ALTER TYPE project_role_type ADD VALUE 'DELIVERY'` (Drizzle generates this).
2. Add `bill_rate NOT NULL DEFAULT 250`, then `ALTER COLUMN … DROP DEFAULT` in the same file.

The backfill is a flat `250` because the card ships with no exceptions — values agree by
construction, so no `CASE` and no TypeScript backfill script. The `DROP DEFAULT` is a hand-edit to
the generated SQL and is the point: with no DB default, a write path that forgets to resolve a rate
fails loudly instead of silently inventing $250. Comment it so it survives a future `db:generate`.

### 5. Margin math — simpler, not more complex

The snapshot decision pays for itself here: because the rate is **on the role**,
`project-margin.ts` stops consulting the card at all.

- **`MarginRoleInput` (L56) gains `billRate: number`** — and needs **no** `lineOfBusiness`, because
  nothing in the math resolves a card rate any more. (The indicator resolves it in the UI, from a
  field `PlanRole` already carries.)
- Restructure the revenue branch (L257-268) so resolution happens once per counted role:
  `rateCardAmount = convert(hours × role.billRate, BILL_RATE_CURRENCY, displayCurrency, usdRates)`,
  then `revenue = isTimeAndMaterials ? rateCardAmount : null`, accumulating `rateCardAmount` for
  §6. Two things worth a code comment: the T&M revenue expression and the fixed-fee comparator
  become *literally the same expression* (the guarantee the panel's new copy needs), and because
  there's no per-role currency column, `noteConversion(BILL_RATE_CURRENCY)` stays exactly one call
  site so the whole §8 FX story is untouched.
- **Gate that on `billing.billingType != null`** and on `countsTowardBudget` — see Trap 1.
- **`RoleMargin` gains `billRate: number | null`** — the rate actually applied, **converted into
  `displayCurrency`** like every other figure in that type (document it; a reader will assume USD).
  Non-null for every counted role on a project with a billing type.
- **Do not add an `isOverride` flag to `RoleMargin`.** A role can be off-card on a *no-budget*
  project where `computeProjectMargin` resolves nothing, so an indicator sourced from `RoleMargin`
  would vanish on exactly the project where the stored rate is most surprising. The indicator reads
  the payload directly. One bit, one home.

**Rate resolution stays client-side, inside the shared compute.** `use-project-margin.ts` keeps
calling `computeProjectMargin`, which imports `billRateFor` directly, exactly as it imports
`BILL_RATES` today. Four reasons: nothing new enters the bundle (`budget-fields.tsx` is already a
`"use client"` importer of the card); ADR 0057's server-side precomputation is a **cost**-privacy
decision that doesn't transfer to a commercial figure (§7's asymmetry); a server-resolved rate would
still need client-side conversion on every currency toggle, so it buys nothing while creating a
second source of truth for one number on one screen; and it preserves 0053's documented
"`computeProjectMargin` takes no rate-card argument" guarantee (`docs/domains/projects.md:1006`).

**The three `MarginRoleInput` builders** each forward a column they already read:

- `src/components/projects/use-project-margin.ts:46-56` — add `billRate: role.billRate`.
- `src/actions/projects/getProjectsList.ts:392-401` — add `billRate: row.billRate`, and the column
  to the select around L362.
- `src/lib/projects/project-margin.test.ts:35-47` — the `role()` factory gains `billRate`.

**Payload types:** `PlanRole` (`getOpportunityPlan.ts:28-42`) gains `billRate: number`; add the
column to both selects (`getOpportunityPlan.ts:183-196`, `getProjectPlan.ts:89-102`). Required, not
optional — that's the compiler pressure that stops either reader being forgotten. **`ExternalAllocation`
(L49-60) does NOT get it** — another project's role is never priced here; say so in a comment,
because `billRateFor`'s structural argument would happily accept one (Trap 5).

### 6. The fixed-fee comparison

Three flat nullable fields on `BudgetTotals` (`project-margin.ts:82`), matching that type's existing
style:

```ts
/** What this plan would bill hourly at each role's own rate — the FIXED_FEE-only
 *  comparator. Null on T&M (where it is identical to `revenue`, so a non-null value
 *  would license a UI printing one number twice and a tautologically-zero delta) and
 *  null with no billing type or no fee. */
rateCardValue: number | null;
/** `revenue − rateCardValue`. Negative = discount to the client, positive = premium. */
rateCardDelta: number | null;
/** `rateCardDelta / rateCardValue`; null when the comparator is 0. */
rateCardDeltaPercent: number | null;
```

All three non-null **iff** `billingType === "FIXED_FEE"` and the fee + currency are set;
`rateCardDeltaPercent` additionally requires `rateCardValue > 0`, reusing `marginOf`'s existing
null-at-zero-denominator convention (L404-413) rather than inventing a second rule.

- **It uses each role's own rate, not the pure card rate.** The roles are where the negotiated price
  lives; comparing the fee against rates nobody agreed to answers a question no one asked. The two
  levels stay separately legible because overrides carry their own indicator.
- **§5 stands unamended: per-role `revenue` is still `null` on fixed fee.** A per-role rate-card
  *value* is deliberately absent — it's one `.reduce()` from the apportionment §5 refused, and a
  reader seeing "$40k" on a fixed-fee row will read it as that role's revenue. But
  `RoleMargin.billRate` **is** non-null there: a rate can't be summed into a fee; an amount can.
  That's the line, and it's what makes the override indicator's value readable on a fixed-fee
  project. Pin it with a test.
- **Round before choosing sign or wording** (`project-margin.ts:189-206`, `plan-format.ts`): a delta
  rendering as `CA$0` must read "at rate card", never "0% discount".
- **No colour.** A discount is a commercial decision, not a loss, and the codebase's convention is
  that only losses get colour (there is no success token, so a premium can't be green). Margin keeps
  the only tone on that panel. Put this non-decision in the ADR — someone will "fix" it otherwise.

### 7. Write paths

`projectRoleFields` (`src/actions/projects/projectRole.schema.ts`) gains one field, mirroring how
`hoursPerDay` already coerces the string the form holds:

```ts
billRate: z.coerce
  .number()
  .positive("Enter a bill rate greater than 0.")
  .max(MAX_MONEY, "That rate is too large."),
```

Required and positive, so the `z.coerce.number()` blank-becomes-zero trap documented at
`projectBudget.schema.ts:30-32` is caught by `.positive()` rather than shipping a free role. Because
all four action schemas spread `...projectRoleFields`, **none of the four needs editing** — that's
the payoff of the shared object. Add `billRate` to `ROLE_ISSUE_FIELDS` in `role-fields.tsx`.
`MAX_MONEY` (`projectBudget.schema.ts:25`) would become the third copy of `9_999_999_999.99`;
extracting `src/lib/schemas/money-schema.ts` is a reasonable optional tidy, not required here.

Every `project_roles` insert must now supply a rate. None of these bodies spread `parsedInput`, so
each needs one line:

| Site | Rate comes from |
|---|---|
| `createProjectRole.ts:43-55`, `createProjectRoleOnProject.ts:37-49`, `updateProjectRole.ts`, `updateProjectRoleOnProject.ts:33-43` | the submitted field, prefilled from the card client-side |
| `createProject.ts:98-113` (roles array) | same — `projectRoleSchema` already carries it, so wire it even though `add-project-dialog.tsx` collects no roles today, or a future caller silently drops it |
| `createProjectFromOpportunity.ts` | the opportunity-plan roles it carries over, verbatim |
| `duplicateProjectRoles.ts` (select L37-45, values L49-62) | **copied from the source** — the action already declares its one deliberate omission (`staffId: null`, "copy the shape, not the person"), so the rate *is* part of the shape. Dropping it would make Duplicate a silent re-pricing. |
| `extendProjectRole.ts` (select L52-58, insert L71-84) | **copied from the source** — an extension is "a continuation"; re-pricing the continuation at the card isn't one. Its schema cherry-picks only `hoursPerDay`, so this is a body change, not a schema one. |
| `scripts/seed/projects.ts` | `billRateFor(...)`, with overrides on a minority of roles |

**Explicitly unchanged, so a reviewer doesn't hunt:** `bumpProjectRoles.ts` (dates only),
`assignRoleStaff.ts` (assigning a person to an overridden open role must not reset its price), and
`allocateStaffToRole.schema.ts` (mirrors the hours rule but creates no role). No new gate anywhere —
all of these already require `projects.edit`, and `assertProjectRoleEditable` /
`assertRoleEditable` are unaffected.

### 8. UI

**Role form** (`src/components/projects/role-fields.tsx`). `RoleFormValues` gains
`billRate: string`; `roleDefaultValues`' `existing` param gains `billRate: number`. Put the field in
its own row after the dates row (that row is already three-up) labelled **"Bill rate (USD/hr)"** —
naming the currency in the label is how the no-per-role-currency decision stays visible. Follow the
established numeric idiom from `budget-fields.tsx:179` (`type="number"`, `inputMode="decimal"`,
`tabular-nums`). The prefill rule is the fiddly part:

- **On create:** `useWatch` `lineOfBusiness` + `roleType`; when either changes, `setValue` to
  `billRateFor(...)` **only while the field is not dirty** (`formState.dirtyFields.billRate`), so
  switching discipline re-prices a fresh row but never clobbers a typed override.
- **On edit:** never auto-change it. A stored rate is a commercial fact about existing work;
  changing a role's discipline must not silently re-price it.

Both dialogs' `shared` objects gain the field — `detail/project-role-dialog.tsx:83-91` and
`opportunity-plan/role-dialog.tsx:72-80`.

**Roles tab** (`detail/project-detail-view.tsx:267-319`). Add a `"Rate"` header between `"Hrs/day"`
and the trailing `...(canEdit ? [""] : [])`. The cell reads `role.billRate` **off the payload, not
off `margin`**, so it renders on a no-budget project too.

The indicator is **contrast, not an ornament**: on-card renders `text-muted-foreground`, off-card
renders default foreground, both `tabular-nums`, and both states carry a `Tooltip` — "Standard rate
card" or "Off rate card — the card is $250/hr" — so the affordance is discoverable either way. No
badge (badges mean status in this table), no glyph, no indigo. Same muted-text + tooltip idiom
`RoleMarginLine` already uses; `TooltipTrigger render={...}` per the Base UI convention.

Off-card is **derived**: `role.billRate !== billRateFor(role)`. No provenance column, no write-path
bookkeeping — see the snapshot-consequence note above for what that costs and why it's accepted.

Format with `formatMoney(rate, BILL_RATE_CURRENCY, { minimumFractionDigits: 0, maximumFractionDigits: 2 })`
— `minimumFractionDigits: 0` is load-bearing, since `style: "currency"` otherwise prints "$250.00",
and `numeric(12,2)` overrides introduce cents the integer card never had.

**Planner grid** (`opportunity-plan/planner-grid.tsx`) — no new column and no new line; the
`PLANNER_LABEL_COL` widths are hand-twinned with the allocations grid (ADR 0053 §9), and the cell
already holds four things. Two changes inside existing chrome:

- Append the rate to the **existing second line only when off-card**: `Engineer · 8h/day · $300/hr`.
  One extra token on the exception, silent on the norm.
- Add a `Rate $300/hr (off card)` / `Rate $250/hr (rate card)` line to `RoleMarginLine`'s existing
  tooltip (L307-323), which already lists hrs / revenue / cost / margin / cost basis. No layout cost.

This needs `PlannerRow` (`src/lib/projects/project-planner-grid.ts:61`) to gain `billRate: number`,
populated in `buildPlannerRows` from the `PlanRole`. External allocations are blocks *inside* rows
(`cell.external`), never rows of their own, so nothing leaks there.

**Budget panel** (`budget-summary-panel.tsx`) — **no fourth `BudgetFigure`**: it breaks the
`sm:grid-cols-3` rhythm and competes with Margin for the headline. The comparison qualifies
*revenue*, so it goes in the Revenue tile's hint as a second muted line:

> Fixed fee · $250,000
> Rate card $284,000 · $34,000 discount (12%)

"discount" when `rateCardDelta < 0`, "premium" when `> 0`. Widen `BudgetFigure`'s `hint` from
`string` to `ReactNode` (it already does that for `value`). Two things to get right:

- **Render it outside the `margin.includesCost` branch** (L137-160). The comparator is revenue-side
  and therefore ungated; nesting it in the cost block is the easy mistake.
- **Don't let it inherit the cost-side caveats.** `unknownCostRoleCount` / `openRoleCount` are about
  cost; a plan of entirely open roles has a *complete* rate-card value. Guard only on
  `totals.rateCardValue != null && margin.countedRoleCount > 0`.

**Rate-card panel** (`budget-fields.tsx:233-270`) — drive `StandardRateCard` off `rateCardSummary()`.
`exceptions.length === 0` keeps today's one-liner ("…$250/hr for every discipline"); otherwise lead
with "…$250/hr unless listed below" and render the same `flex justify-between` rows keyed
`${lineOfBusiness}-${roleType}`, labelled `Core · Engineer` via `LINE_OF_BUSINESS_LABELS`. Keep the
"set in code, not per project — last reviewed {BILL_RATES_REVIEWED_ON}" footer. Show it for **both**
billing types now, not just T&M: under fixed fee the card is both the comparison baseline and the
seed for each role's rate. Don't mention the per-role override here — this panel is about the card,
and the dialogs rendering it collect no roles.

### 9. Docs, tests, seed

**New ADR 0066, superseding ADR 0053 in part — not an in-place amend.** 0053 §1 (L66-70) rejected
this column *by name*; editing that paragraph would erase the reasoning that makes the reversal a
decision. Use the pattern 0053 already uses for 0057 (its own L15-22): a new 0066, a
`> **Superseded in part by ADR 0066…**` blockquote at 0053's top, and a one-line annotation on §1's
rejection paragraph, text intact. 0066 must record: the two-key `Partial` card and that **totality
moved from the type checker to a `??`**, losing build-time pressure to price a new discipline; why
the column is now accepted, answering §1's two objections; snapshot-vs-live and what the imprecise
indicator costs; copy semantics and why a silent re-pricing is worse than a visible travelling rate;
the `BudgetTotals` comparator with §5 standing and per-role value deliberately absent; the
uncoloured delta; client-side resolution and why 0057's precedent doesn't transfer; **no capability
and no matrix change, with the reason**; still no rate history; and Traps 1–3 below.

**Then dispatch the `librarian`.** Known-stale, with line numbers:

- `docs/domains/projects.md` — L159-161, L241, **L312-320** (the whole rate-card bullet), L738,
  L906-909, **L1005-1009** (`hours × BILL_RATES[roleType]`, and the
  unpriced-is-unrepresentable-*because-total* sentence), L1292 (Roles-tab column list), L1414,
  L1573-1577.
- `docs/data-model.md` — L31, L35 (the margin formula), L62, **L96** ("bill rates are NOT a table"),
  L127.
- `docs/architecture.md:141` — literally reads `BILL_RATES (TOTAL over role types) … + isFlatRateCard()`.
- `docs/ui.md:497-498` — names `isFlatRateCard()` / `standardRateCard()`.
- `AGENTS.md` status paragraph — "a per-discipline rate card".
- `docs/decisions/0057-*.md:67,217` cite `BILL_RATES` as precedent — still valid, no edit.
- `docs/domains/permissions.md` — **no change.**

**Tests** — extend `src/lib/projects/project-margin.test.ts` only. Per ADR 0037 it is a *sanctioned*
exception; a new `bill-rates.test.ts` would be a new one to argue, so put the `billRateFor` cases
there too.

- L56 `const RATE = BILL_RATES.ENGINEER` → `billRateFor({ lineOfBusiness: "CORE", roleType: "ENGINEER" })`;
  factory gains `billRate`. Every existing `80 * RATE` expectation then still holds.
- **Rewrite L193** ("a fixed fee applies no rate card, so nothing is converted") — now two cases:
  USD display still `[]`; CAD display **must** include `"USD"` (Trap 1).
- New `describe("billRateFor")` looping `LINE_OF_BUSINESS × PROJECT_ROLE_TYPES`: every pair returns
  its listed exception or exactly `DEFAULT_BILL_RATE`, never `undefined` or `0`. Meaningful whether
  the exceptions map is empty or full. Cover `rateCardSummary()` ordering here too, since an empty
  map leaves that path otherwise unexercised.
- New: an off-card rate wins over the card, in the card's currency (`billRate: 300` → `80 * 300`,
  `convertedFrom` still `[]` in USD) and converts like it (CAD display → `80 * 300 * 2`).
- New: fixed fee — a `16_000` fee against one 80h ENGINEER role at 250 → `rateCardValue 20_000`,
  `rateCardDelta -4_000`, `rateCardDeltaPercent ≈ -0.2`.
- New: T&M reports `rateCardValue: null`; no billing type reports `null`.
- New: a fixed-fee row has `revenue === null` **but** `billRate !== null`.
- New: a cancelled role contributes nothing to `rateCardValue`.

**Seed** (`scripts/seed/projects.ts:169-190`) — `billRate: chance(0.15) ? money(180, 400) : billRateFor(...)`,
and add `DELIVERY` to the `roleType` pick. Keep the override probability **low**: an override is an
exception, and seeding half the roles would make the "subtle indicator" the norm and hide the design
it expresses. `billingFor()` already produces fixed-fee projects with roles, so the delta line gets
exercised. **`scripts/seed/wipe.ts` needs no change** — no new table.

---

## Traps

1. **`convertedFrom` regression on fixed fee — the sharpest one.** Computing `rateCardAmount`
   unconditionally makes `noteConversion(BILL_RATE_CURRENCY)` fire on fixed-fee plans, so
   `FxRateNote` starts appearing on fixed-fee panels viewed in CAD. That's *correct* (a USD-derived
   figure is now on screen) but it reverses a shipped test and a documented §8 claim. **Gate on
   `billing.billingType != null`**, or a no-budget project claims conversions it never made.
2. **The delta is FX-dependent.** `resolveDisplayCurrency` opens a CAD fee in CAD, so every CAD
   fixed-fee panel now converts, and the discount percentage moves with the exchange rate at zero
   commercial change. Not fixable inside §8's one-currency-per-panel rule — document it.
3. **`getProjectsList` flags will shift.** `project-flags.ts` thresholds are unchanged while their
   inputs move, so a project can flip in or out of "Low margin" purely from an override. Also: the
   list uses list-scoped `nativeCurrencies` rather than `convertedFrom`, so Trap 1 is invisible
   there and `getProjectsMarginContext.ts` needs **no change** — worth stating, because it looks
   like it should.
4. **Overrides on a `billingType: null` project are legal and invisible in money** — the Roles-tab
   indicator shows a rate on a project whose panel says "No budget set". Intended (the rate is a
   property of the role) but odd; the tooltip copy should carry it.
5. **`billRateFor`'s structural argument accepts an `ExternalAllocation`** — it has both
   `lineOfBusiness` and `roleType`, so nothing prevents pricing another project's role by accident.
6. **The create-project dialog can't set an override** (`add-project-dialog.tsx` collects no roles),
   so a nonstandard price needs a second step in the planner. Fine, but say it so nobody hunts.
7. **`createProjectFromOpportunity` inherits a sales-set rate.** Opportunity-plan roles are created
   under `loadOpportunityPlan`, gated on **`crm.edit`** — so `sales` can set a bill rate, and it
   becomes the project's rate with no re-confirmation. Consistent with §7 (sales already sees
   revenue) but worth deciding explicitly rather than discovering later.

---

## Files touched

**Core:** `src/lib/projects/bill-rates.ts` · `src/lib/projects/project-role-type.ts` ·
`src/lib/db/projects-schema.ts` · `src/lib/projects/project-margin.ts` ·
`src/actions/projects/projectRole.schema.ts` · `src/lib/projects/project-planner-grid.ts`

**Write paths:** `src/actions/projects/{createProject,createProjectRole,createProjectRoleOnProject,updateProjectRole,updateProjectRoleOnProject,createProjectFromOpportunity,duplicateProjectRoles,extendProjectRole}.ts`

**Reads:** `src/actions/projects/{getProjectPlan,getOpportunityPlan,getProjectsList}.ts`

**UI:** `src/components/projects/{role-fields,budget-fields,budget-summary-panel,use-project-margin}` ·
`src/components/projects/detail/{project-detail-view,project-role-dialog}.tsx` ·
`src/components/projects/opportunity-plan/{role-dialog,planner-grid}.tsx`

**Other:** two files in `drizzle/` · `scripts/seed/projects.ts` ·
`src/lib/projects/project-margin.test.ts` · `docs/decisions/0066-*.md` + the 0053 blockquote

## Order

1. `bill-rates.ts` reshape + `DELIVERY`. `bun run check` then enumerates every broken exhaustive
   map and the three `BILL_RATES` sites — that's the checklist.
2. `billRate` column + check + the stale in-file comments; `db:generate` → hand-edit the
   `DROP DEFAULT` → `db:migrate`.
3. `projectRoleFields`.
4. `PlanRole.billRate` + both plan selects + the `getProjectsList` select. Leave
   `ExternalAllocation` alone.
5. `project-margin.ts`: `MarginRoleInput`, the resolution restructure, `RoleMargin.billRate`, the
   three `BudgetTotals` fields.
6. The three `MarginRoleInput` builders.
7. Action bodies, including `duplicateProjectRoles` / `extendProjectRole`.
8. `role-fields.tsx` + the two dialogs.
9. UI: Roles-tab column, `PlannerRow` + planner line & tooltip, budget-panel hint, rate-card panel.
10. Tests, then seed.
11. ADR 0066 + the 0053 blockquote, then dispatch `librarian`.

## Verification

- **`bun run check`** — Biome + `tsc --noEmit` + `bun test`. The RBAC matrix test must stay green
  (nothing should touch it). The extended margin tests are the real evidence for §6.
- **`bun run build`** — required: this touches client/server boundaries, and `bill-rates.ts` must
  stay drizzle-free or it lands in the client bundle.
- **`bun run db:generate` must produce no pending diff** after step 2 — proof schema and migrations
  agree.
- **`bun run db:seed`**, then spot-check in SQL: no null `bill_rate`, at least one `DELIVERY` role,
  and a mix of on- and off-card rates.
- `/code-review` and `/security-review` before merge, per AGENTS.md.
- **Runtime check is yours** — I don't run the app. When the code is in I'll ask you to open a
  fixed-fee project and a T&M project and confirm: the Rate column and its off-card contrast, the
  fixed-fee discount/premium line, that a viewer *without* `projects.viewMargin` still sees rates
  but no cost, and that creating a role prefills the rate while editing one never silently
  re-prices it.
