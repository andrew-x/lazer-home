# Bonus payments — design

**Date:** 2026-07-30
**Domains:** staff profiles, performance (compensation dashboard)

## Problem

`staffEmployment.discretionaryBonus` models a bonus as a **property of a
compensation package** — a column on an effective-dated employment row. That is
the wrong shape. A bonus is not an ongoing term of employment; it is a **payment
that happened on a date**. Storing it on the employment row means it reads as
part of what someone is paid going forward, it can only be restated by spawning
a new employment row, and a person who received two bonuses in a year has
nowhere to put the second one.

Separately, there is no way to answer "how much did we pay out in bonuses this
year, and where did it go?"

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Bonus payments live in their own table, `staffBonusPayment`; `staffEmployment.discretionaryBonus` is **dropped** | One home per fact. The column is `notNull default 0` and was never imported, so there is no data to migrate. |
| 2 | A payment carries a **type** (6 values), not just an amount | The table generalizes beyond discretionary: incentive payouts, signing bonuses, referrals, gifts. |
| 3 | `DISCRETIONARY` = decided in a **review cycle**; `SPOT` = **ad-hoc** | The two otherwise mean the same thing and would fragment the by-type totals. This ties `DISCRETIONARY` back to `compensationPlanItem.plannedBonus`. |
| 4 | Line of business + role are resolved **as of the payment date**, never stored on the payment | Historically correct: a February bonus counts under the discipline held in February. Past-year totals never silently change when someone moves role. |
| 5 | `compensationPlanItem.plannedBonus` stays a **proposal only**; commit still writes ratings, never pay | ADR 0046 holds. Rippling remains the system of record for money. |
| 6 | The dashboard totals **include payments to now-inactive staff** | A March bonus to someone who left in June was still spent this year. Consequence: this section does not reconcile per-head with the active-only headcount tables above it — the UI copy says so. |
| 7 | `GIFT` counts toward the headline total, at its cash-equivalent value | Makes the top line "total reward spend" rather than "cash out the door". The by-type table separates them. |
| 8 | Write gate is `staff.viewCompensation` **AND** `staff.edit` (managers + admins) | Same combined-gate pattern the compensation-plan surfaces already use. No new capability, so no matrix change. Finance can view dashboard totals but not record payments. |
| 9 | The entry surface lives **in-app**, not under `/admin` | `src/app/admin/*` is localhost-gated maintenance (hence `localActionClient` on the importers). Recording a bonus is an ongoing production workflow. |
| 10 | The Rippling importer is **out of scope**; `ripplingId` is reserved for it | Deferred deliberately. A nullable unique column now saves a migration later and gives the importer its idempotency key. |

## Data model

### New pure module: `src/lib/staff/staff-bonus.ts`

Values live in a pure, client-importable module so the pgEnum, the zod schemas
and the display labels share one source of truth — the
`COMPENSATION_PLAN_STATUSES` convention.

```ts
export const BONUS_TYPES = [
  "DISCRETIONARY",
  "SPOT",
  "INCENTIVE",
  "SIGNING",
  "REFERRAL",
  "GIFT",
] as const;

export type BonusType = (typeof BONUS_TYPES)[number];

export const BONUS_TYPE_LABELS: Record<BonusType, string> = { ... };
```

| Value | Label | Meaning |
|---|---|---|
| `DISCRETIONARY` | Discretionary | Decided in a compensation review cycle — what `compensationPlanItem.plannedBonus` proposes |
| `SPOT` | Spot | Ad-hoc recognition awarded outside any cycle |
| `INCENTIVE` | Incentive | Milestone / target payout |
| `SIGNING` | Signing | Paid on joining |
| `REFERRAL` | Referral | Paid for referring a hire |
| `GIFT` | Gift | Non-cash; `amount` is the cash-equivalent value |

These meanings go in the schema comment verbatim — the `DISCRETIONARY`/`SPOT`
distinction is not self-evident from the value names.

### New table: `staffBonusPayment` (in `src/lib/db/staff-schema.ts`)

Sibling to `staffPto` — the same kind of thing: a dated event about a person,
destined to be sourced from Rippling.

```ts
export const staffBonusTypeEnum = pgEnum("staff_bonus_type", [...BONUS_TYPES]);

export const staffBonusPayment = pgTable("staff_bonus_payment", {
  id: text().primaryKey(),
  staffId: text().notNull().references(() => staff.id, { onDelete: "cascade" }),

  // The point in time. The ONLY date that matters — a payment is not
  // effective-dated and is never superseded.
  paymentDate: date().notNull(),

  // No default: recording a payment means knowing why it was paid.
  type: staffBonusTypeEnum().notNull(),

  amount: numeric({ precision: 12, scale: 2, mode: "number" }).notNull(),
  currency: currencyEnum().notNull(),

  // Free text for anything the type doesn't capture (which milestone, who was
  // referred, what the gift was).
  notes: text(),

  // Rippling's payment id, reserved for the importer that will own this table.
  // Nullable while rows are entered by hand; unique so re-import is idempotent.
  ripplingId: text().unique(),

  createdAt / updatedAt,
}, (t) => [
  index("staff_bonus_payment_staff_idx").on(t.staffId),
  index("staff_bonus_payment_date_idx").on(t.paymentDate),
  check("staff_bonus_payment_amount_positive", sql`${t.amount} > 0`),
]);
```

Deliberately **no** `lineOfBusiness`/`role` columns and no FK to
`staffEmployment` — attribution is derived (decision 4).

Export `StaffBonusPayment = InferSelectModel<typeof staffBonusPayment>` with the
other row types.

### Removal of `staffEmployment.discretionaryBonus`

Full end-to-end deletion. Every touch point:

| File | Change |
|---|---|
| `src/lib/db/staff-schema.ts` | drop the column + its comment |
| `src/lib/staff/staff-import/types.ts` | drop from `normalizedStaffSchema`, the column tuple, and the comparable snapshot type |
| `src/lib/staff/staff-import/transform.ts` | drop the hardcoded `discretionaryBonus: 0` |
| `src/lib/staff/staff-import/plan.ts` | drop from the projection + the diff snapshot |
| `src/actions/admin/commitStaffImport.ts` | drop from both insert paths |
| `src/actions/admin/commitBulkEditEmployment.ts` | drop from the carry-forward projection and the new-row values |
| `src/components/admin/staff-import.tsx` | drop from the preview column list |
| `src/actions/staff/getStaffProfile.ts` | drop from the picked columns + projection |
| `src/actions/staff/loadStaffProfileDrawer.ts` | drop from `compensation` |
| `src/components/staff/compensation-section.tsx` | drop the prop and its row |
| `src/components/staff/profile-view.tsx` | drop the prop pass-through |
| `src/actions/staff/getStaffHistory.ts` | drop from `compParts` and the projection |
| `scripts/seed/staff.ts` | drop the field |

Migration: `bun run db:generate` → `bun run db:migrate`. The generated SQL
creates the enum + table and drops the column; no data migration (the column is
uniformly 0).

## Attribution — `src/lib/staff/bonus-attribution.ts`

One pure, unit-tested resolver. The only real logic in this feature.

```ts
/**
 * The employment row a payment should be attributed to: the most recent row
 * effective on or before the payment date.
 *
 * Falls back to the EARLIEST row when a payment predates all employment history
 * (a backfilled signing bonus dated before the first employment row) — the money
 * was spent, so it must land somewhere rather than be silently dropped.
 * Returns null only when the person has no employment rows at all.
 */
export function employmentAsOf<T extends { effectiveFromDate: string }>(
  rows: readonly T[], // newest-first (`latestEmploymentFirst`)
  date: string,
): T | null;
```

Tests: exact-date match, between two rows, after the last row, before the first
row (fallback), empty rows, and a same-day tie (newest wins).

## Reads

### `src/actions/performance/getBonusSummaryData.ts` (server-only)

Gated `staff.viewCompensation` via `requirePermission`, mirroring
`getCompensationSummaryData`.

```ts
export type BonusRecord = {
  lineOfBusiness: LineOfBusiness;
  role: Role;
  employmentType: EmploymentType;
  type: BonusType;
  amount: number;
  currency: Currency;
};

export type BonusSummaryData = {
  records: BonusRecord[]; // anonymized
  years: number[];        // descending; every year with at least one payment
};

export async function getBonusSummaryData(year: number): Promise<BonusSummaryData>;
```

**Anonymized — carries no identity**, same contract as `CompensationRecord`.
Two queries, no N+1: payments in `[YYYY-01-01, YYYY-12-31]`, and all employment
rows for the staff ids those payments reference (ordered
`latestEmploymentFirst`). Resolve each payment's dimensions with
`employmentAsOf`. Payments whose person has no employment rows at all are
skipped, and the read reports the skipped count so the UI can surface it rather
than silently under-reporting.

No `isActive` filter — decision 6.

### `src/actions/staff/getStaffBonusHistory.ts` (server-only)

```ts
export type StaffBonusEntry = {
  id: string; paymentDate: string; type: BonusType;
  amount: number; currency: Currency; notes: string | null;
};
export type StaffBonusView = {
  entries: StaffBonusEntry[];
  /**
   * Current-calendar-year totals, one per currency the person was paid in.
   * Per-currency rather than a single number: this is a per-person view, so it
   * does no FX conversion. Empty when there are no payments this year.
   */
  ytdTotals: { currency: Currency; total: number }[];
};

export async function getStaffBonusHistory(staffId: string): Promise<StaffBonusView | null>;
```

Self-gating like `getStaffPto`: returns `null` (not throws) unless it is the
caller's own record or they hold `staff.viewCompensation`. `null` means "not
permitted" → the drawer renders no tab.

### `getStaffHistory` gains a `BONUS` category

- `HistoryCategory` becomes `"EMPLOYMENT" | "BONUS" | "ALLOCATION"`.
- Behind the **existing** `includeCompensation` flag — bonuses are money, and
  history renders in a client component, so the amounts must be filtered at the
  read. When the flag is false, bonus entries are omitted **entirely** (not
  amount-stripped): the existence and timing of a bonus is itself compensation
  information.
- Summary format: `Spot bonus · CA$5,000.00 · <notes>` (notes truncated).
- Sorted into the same newest-first feed by `paymentDate`.

## Writes

Three actions in `src/actions/staff/`, all `secureActionClient` with the
combined gate declared in metadata (decision 8):

```ts
.metadata({
  action: "create-bonus-payment",
  permission: { staff: ["edit", "viewCompensation"] },
})
```

| Action | Notes |
|---|---|
| `createBonusPayment.ts` | inserts with `generateId("sbp")`; `ripplingId` left null |
| `updateBonusPayment.ts` | full-row update by id |
| `deleteBonusPayment.ts` | hard delete — a payment recorded in error is not history worth keeping |

Shared schema in `bonusPayment.schema.ts` — **hand-written `z.object()`, no
drizzle** (the form is a client component, so the module must not pull the table
into the bundle). Shared `bonusPaymentFields` spread into both create and
update; update adds `id`. Validation: `amount` positive with 2-decimal
precision, `paymentDate` a `YYYY-MM-DD` date string not in the future,
`type` `z.enum(BONUS_TYPES)`, `currency` the pure currency tuple, `notes`
optional trimmed text. Each schema exports its inferred input type.

All three `revalidatePath` the bonus admin route, the compensation dashboard,
and — via `revalidateStaffProfile` — the affected person's profile.

A static `permission` gate is sufficient here: the actions take a
`staffId`/payment id but the capability is org-wide (a manager may record a
bonus for anyone), so there is no ownership dimension to check. No
`metadata.authorize` hook.

## UI

### Compensation dashboard — `/performance/compensation`

A new **"Bonus payments"** section below the existing by-role and by-level
breakdowns, in `compensation-dashboard.tsx` (or a `bonus-breakdown.tsx`
extracted alongside it, given the file's existing size).

- Respects the existing filter bar (`lineOfBusiness`, `role`, `employmentType`)
  and display currency, converting each payment via `convert`/`ExchangeRates`.
- Its own **year selector**, defaulting to the current calendar year, options
  from `years`.
- A `StatCard` row: **total paid**, **payments**, **recipients**.
- Three tables in the existing `byRole` style, each with total / recipients /
  average per recipient and an "All" footer: **by line of business**, **by
  role**, **by type**.
- Copy states that totals include people who have since left, so this section
  does not reconcile per-head with the headcount above.

Aggregation logic goes in `src/lib/performance/bonus-stats.ts`, pure and
unit-tested, alongside `performance-stats.ts`.

### In-plan profile drawer — new **Bonuses** tab

`staff-profile-drawer.tsx`: a tab after Overview, before Projects, rendered only
when `bonusHistory` is non-null (the absent-tab convention — an absent tab never
explains itself). Lists date · type · amount · notes, newest first, with the
year-to-date total at the top. Data flows through `loadStaffProfileDrawer`,
which gains `bonusHistory: StaffBonusView | null` and calls
`getStaffBonusHistory` in its existing `Promise.all`.

### Staff profile

- History timeline shows bonus entries inline (via `getStaffHistory`).
- The compensation section loses its discretionary-bonus row.

### Bonus payments admin surface — `/performance/compensation/bonuses`

An in-app page behind the combined gate. A table of payments (person, date,
type, amount, currency, notes) with a filter by year and person, plus an
add/edit dialog and a delete confirmation. Follows the existing form patterns
(`react-hook-form` + the schema resolver + `useAction`). Linked from the
compensation dashboard's bonus section, but only for viewers holding both
`staff.edit` and `staff.viewCompensation` — finance sees the totals with no
link to a surface it cannot use.

## Seed

`scripts/seed/staff.ts`: drop the `discretionaryBonus` field and generate
synthetic bonus payments — a plausible spread across all six types and the last
two-plus calendar years, some people with several payments, some with none, at
least one dated before the person's first employment row (to exercise the
attribution fallback) and one in a non-home currency.

## Permissions

No matrix change (decision 8), so `permissions.ts`,
`src/lib/permissions.test.ts` and `docs/domains/permissions.md` are untouched.
The reads reuse `staff.viewCompensation`; the writes reuse `staff.edit` +
`staff.viewCompensation` together.

## Testing

- `bonus-attribution.test.ts` — the six cases above.
- `bonus-stats.test.ts` — grouping by LOB/role/type, multi-currency conversion,
  recipient counts (a person with three payments counts once), empty input.
- Schema validation: negative amount, >2 decimals, future date, bad enum.
- `bun run check` (Biome + `tsc --noEmit` + `bun test`) and `bun run build`.

## Out of scope

- **The Rippling importer.** Follow-on slice: a `bonus-import` module mirroring
  `pto-import` (types/transform/plan) plus a `preview`/`commit` action pair,
  keyed on `ripplingId`. Until it lands, payments are entered by hand.
- Writing `compensationPlanItem.plannedBonus` through to a payment on plan
  commit. ADR 0046 stands; revisit only as a deliberate decision.
- Bonus budgets, targets, or accruals.

## Docs to update (librarian, after implementation)

- `docs/domains/staff-profiles.md` — the new table, the dropped column.
- `docs/domains/performance.md` — the dashboard section.
- `docs/data-model.md` — `staffBonusPayment` and its derived attribution.
- `docs/decisions/0020-compensation-effective-dated-import-only.md` — note that
  bonus payments are deliberately **not** compensation and so are not bound by
  this ADR's import-only rule.
- A new ADR: bonuses as dated payments, not compensation terms (decisions 1, 4,
  6, 7).
