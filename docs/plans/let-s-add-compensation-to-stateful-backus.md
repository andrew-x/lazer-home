# Add compensation to staff employment

## Context

Staff employment facts (role, line of business, billability, target) are tracked
in the effective-dated `staff_employment` table (ADR 0007), but **compensation is
not captured anywhere**. ADR 0007 explicitly anticipates this: *"rates/cost are
expected to follow"* the effective-dating pattern, and the profile history feed
already ships a stubbed `COMPENSATION` category waiting to be wired in.

We want to:
- Store per-person compensation (base, hourly rate, guaranteed bonus,
  discretionary bonus, currency) as **effective-dated facts on `staff_employment`**,
  so a comp change creates a new row and appears in history like any other change.
- Populate it from the **Rippling CSV import** (4 mapped columns; discretionary
  bonus is deferred).
- **Show it on staff profiles and in the history feed**, gated because it's salary
  data.

### Decisions (confirmed with the user)

- **Who can view others' comp:** finance + manager + admin roles, via a new
  `staff: ["viewCompensation"]` capability.
- **Own comp:** a person **always** sees their own compensation on `/profile`,
  regardless of the role gate.
- **Editing:** **import-only.** No new in-app edit UI. But every path that spawns a
  new employment row (import re-sync, bulk-edit) **must carry comp forward** so a
  role/LoB change never wipes salary.

### Fields & CSV mapping

| Field | Type | CSV column |
|---|---|---|
| `base` | numeric | "Annual base remuneration" |
| `hourlyRate` | numeric | "Hourly Rate" |
| `guaranteedBonus` | numeric | "Target annual bonus" |
| `discretionaryBonus` | numeric | *ignored for now* (column exists, never imported) |
| `currency` | enum (CAD/USD/GBP/EUR) | "Compensation currency" |

All comp fields are **nullable** (hourly staff have no base; salaried have no rate).

---

## Implementation

### 1. Shared currency module — `src/lib/currency.ts` (new)

Mirror `src/lib/line-of-business.ts` (pure, client-safe, single source of truth):
- `export const CURRENCY = ["CAD", "USD", "GBP", "EUR"] as const;` + `type Currency`.
- `CURRENCY_LABELS` map.
- `formatMoney(amount: number, currency: Currency): string` using
  `new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount)`.
- `normalizeCurrency(raw: string): Currency | null` — trim + uppercase, match a
  `CURRENCY` code; unrecognized/blank → `null` (never throws; comp is optional).

### 2. Schema — `src/lib/db/staff-schema.ts`

- Import `numeric` from `drizzle-orm/pg-core` and `CURRENCY` from `@/lib/currency`.
- Add `export const currencyEnum = pgEnum("currency", [...CURRENCY]);` (alongside the
  other enums; sourced from the pure module like `lineOfBusinessEnum`).
- Add to `staffEmployment` (all nullable), with a comment that these are
  effective-dated comp facts carried forward across non-comp changes:
  ```ts
  base: numeric({ precision: 12, scale: 2, mode: "number" }),
  hourlyRate: numeric({ precision: 12, scale: 2, mode: "number" }),
  guaranteedBonus: numeric({ precision: 12, scale: 2, mode: "number" }),
  discretionaryBonus: numeric({ precision: 12, scale: 2, mode: "number" }),
  currency: currencyEnum(),
  ```
  `mode: "number"` (verified supported in drizzle-orm 0.45.2) returns JS numbers, so
  the diff's `!==` comparison and `formatMoney` work without string coercion.
- Migration: `bun run db:generate` → `bun run db:migrate`.

### 3. Import parse helper — `src/lib/csv-import/parse.ts`

Add a generic, dependency-free numeric parser (none exists today):
```ts
/** Parse a money/number cell (strips currency symbols, commas, spaces); blank/NaN → null. */
export function parseNumber(input: string): number | null
```
Strip `[^0-9.\-]`, parse, return `null` for blank/`NaN`/negative. (Currency
normalization lives in `currency.ts`, not here — keeps this module currency-agnostic.)

### 4. Import types — `src/lib/staff-import/types.ts`

- Import `CURRENCY`/`Currency` from `@/lib/currency`.
- Extend `normalizedStaffSchema` with `base`/`hourlyRate`/`guaranteedBonus`/
  `discretionaryBonus`: `z.number().nonnegative().nullable()` and
  `currency: z.enum(CURRENCY).nullable()`.
- Add all five to **`EMPLOYMENT_FIELDS`** (so a comp change triggers a new employment
  row + shows as changed in the preview).
- Add all five to **`ComparableSnapshot`** (`number | null` / `Currency | null`).

### 5. Import transform — `src/lib/staff-import/transform.ts`

In the pushed row, read the mapped columns (comp parse **never skips a row** — comp
is optional/supplementary):
```ts
base: parseNumber(getField(raw, "Annual base remuneration")),
hourlyRate: parseNumber(getField(raw, "Hourly Rate")),
guaranteedBonus: parseNumber(getField(raw, "Target annual bonus")),
discretionaryBonus: null, // deferred — not imported yet
currency: normalizeCurrency(getField(raw, "Compensation currency")),
```

### 6. Import diff + carry-forward — `src/lib/staff-import/plan.ts`

- Select the 5 comp columns in the employment query; add them to the `current`
  snapshot.
- **Carry-forward-on-blank:** comp is upsert-only via import and must never be
  cleared by a re-sync that omits the columns. Fold comp into the existing
  `effective` computation (next to the LEADERSHIP special-case) so each comp field
  is `incoming.X ?? current.X`. This means:
  - A blank/absent comp cell keeps the current value (no spurious "changed").
  - `discretionaryBonus` (never in CSV → always `null`) is always carried forward.
  - A **new** comp value in the CSV correctly registers as a change → new row.
- The existing `changedFields` / `employmentChanged` loops over `EMPLOYMENT_FIELDS`
  then pick up real comp changes automatically.

### 7. Commit import — `src/actions/admin/commitStaffImport.ts`

Add the 5 comp fields to **both** employment-insert paths (create uses `row.*`;
update uses `incoming.*`, which is the carried-forward `effective` from the plan).

### 8. Bulk-edit carry-forward — `src/actions/admin/commitBulkEditEmployment.ts`

Comp is **not** editable here (import-only), but the insert-mode path creates new
employment rows and would otherwise write `null` comp:
- Add the 5 comp columns to the `employmentRows` select (`latestByStaff`).
- In the **insert-mode** row build (`effectiveDate` set), carry comp forward from
  `latest` (`base: latest.base`, …).
- The **in-place update** path (`effectiveDate` null) already leaves comp columns
  untouched — no change needed. `FACT_FIELDS` stays as-is (comp not editable).

### 9. Permissions — `src/lib/permissions.ts` + tests + docs

- Add `"viewCompensation"` to the `staff` statement: `staff: ["edit", "viewCompensation"]`.
- Grant it to `finance` (`ac.newRole({ staff: ["viewCompensation"] })` — the role is
  currently empty and purpose-built for this), `manager`, and `admin`.
- Keep the three in lockstep: update `src/lib/permissions.test.ts` matrix assertions
  and `docs/domains/permissions.md`. Run `/audit-rbac` after.

New authorization helper — `src/actions/staff/canViewCompensation.ts` (mirror
`canEditStaff.ts`):
```ts
export async function canViewCompensation(user, targetStaffId): Promise<boolean>
// true if user holds staff.viewCompensation, OR targetStaffId is the user's own staff record
```

### 10. Profile read — `src/actions/staff/getStaffProfile.ts`

Add the 5 comp fields to the employment `select` and to the `StaffProfile.employment`
`Pick`. (Read returns comp; visibility is gated at render — see below. `ProfileView`
is a Server Component, so the comp card is server-rendered and never reaches the
client for unauthorized viewers.)

### 11. Profile UI — `src/components/staff/profile-view.tsx` (+ new section component)

- New `src/components/staff/compensation-section.tsx` (mirror `skills-section.tsx`):
  renders label/value rows in the `LinkRow` style using `formatMoney(amount, currency)`;
  empty state "No compensation on file." Shows base, hourly rate, guaranteed bonus,
  discretionary bonus, and currency.
- Add a **Compensation `Card`** to `ProfileView` (matching the Links/Skills cards),
  rendered only when a new `canViewCompensation: boolean` prop is true. No
  `CardAction`/edit control (import-only).
- Thread `canViewCompensation` from the two pages:
  - `src/app/(app)/staff/[id]/page.tsx` — `await canViewCompensation(user, staffId)`.
  - `src/app/(app)/profile/page.tsx` — own profile, always `true`.

### 12. History feed — `src/actions/staff/getStaffHistory.ts`

- `HistorySheet` is a **client** component, so comp in history entries would serialize
  to the client — gate at the **read**: add an `includeCompensation: boolean` param;
  only build `COMPENSATION` entries when `true`. Pages pass
  `canViewCompensation(user, staffId)`.
- Select comp columns. Emit a `category: "COMPENSATION"` entry **only when a row's
  comp differs from the chronologically previous row** (walk rows oldest→newest; emit
  on the first row that has comp and on each subsequent change). Summary via
  `formatMoney`, e.g. `"Base CA$150,000 · Bonus CA$20,000"`. The `COMPENSATION`
  category label already exists in `history-sheet.tsx` — **no UI change**.

### 13. Import UI — `src/components/admin/staff-import.tsx`

- Add comp columns to `NEW_COLUMNS` and `UPDATE_FIELDS` (base, hourly rate,
  guaranteed bonus, currency — discretionary omitted).
- Extend `formatValue` to render money via `formatMoney` and pass currency through.
- Update `fileCard.description` to list the 4 new expected headers.

### 14. Docs (librarian)

After implementation, **dispatch the `librarian` subagent** (per AGENTS.md) to
reconcile `/docs`: `docs/domains/staff-profiles.md`, `docs/domains/permissions.md`,
`docs/data-model.md`, and a new ADR recording *"compensation as effective-dated
facts on `staff_employment`, import-only, carry-forward-on-blank, view-gated."*

---

## Verification

1. **Schema:** `bun run db:generate` → `bun run db:migrate` (confirm the migration
   adds 5 columns + the `currency` enum).
2. **Static:** `bun run check` (Biome + `tsc` + tests, incl. the RBAC matrix test) and
   `bun run build`. Run `/audit-rbac`.
3. **Import end-to-end:** on the localhost admin page `/admin/upload-staff`, upload a
   Rippling CSV that includes the 4 comp columns. Verify:
   - Preview shows parsed comp in the New/Updates tables (money-formatted).
   - Commit persists; re-uploading a CSV **without** the comp columns does **not**
     wipe comp (carry-forward), and re-uploading with a **changed** base creates a new
     employment row.
4. **Profile display (auth matrix):**
   - As **finance/manager/admin** viewing `/staff/[id]` → Compensation card visible.
   - As a plain **user** viewing someone else's `/staff/[id]` → card hidden, and comp
     absent from the page HTML and the history payload.
   - Any user on their own `/profile` → own comp visible.
5. **History:** open the History drawer for someone with comp changes → `COMPENSATION`
   entries appear (only for authorized viewers), one per actual comp change, newest
   first, interleaved with `EMPLOYMENT` entries.
6. **Bulk-edit regression:** via the bulk-edit path, change a role with an effective
   date (insert mode) → confirm the new employment row **retains** the person's comp.
