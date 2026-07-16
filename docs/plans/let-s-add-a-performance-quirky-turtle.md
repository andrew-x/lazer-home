# Performance dashboard — compensation & headcount analytics

## Context

The PSA platform has a partially-built Performance domain (peer feedback only). We're
adding the first **analytics** slice: a `/performance` dashboard that summarizes the
workforce over compensation and headcount, so leadership/finance can see the shape of
the org and its pay at a glance.

It shows, **overall and broken down by role**:
- Headcount
- Average compensation
- Compensation range (min / max)
- Average hourly rate
- Hourly-rate range (min / max)

With filters at the top (segmented controls, defaulting to "everyone"): **line of
business**, **employment type** (full-time salaried vs hourly), and **role**. Plus a
**currency toggle (CAD / USD)** that normalizes every amount to the chosen currency
using live exchange rates from [frankfurter.dev](https://frankfurter.dev/).

### Decisions locked in
- **"Compensation" = `base` + `guaranteedBonus`** (excludes discretionaryBonus, which
  isn't imported yet). Hourly-rate stats use the stored `hourlyRate` column directly.
- **"Full-time vs part-time" filter = `employmentType`** (`FULL_TIME` = salaried vs
  `HOURLY`) — the only field in the schema that maps to this; there is no true PT flag.
- **Display = stat cards + a by-role breakdown table.** No charting library added
  (keeps the flat/editorial design language; no new dependency).
- **Access = existing `staff.viewCompensation` capability** (roles: `finance`,
  `manager`, `admin`). No role-matrix change, so the 3-file lockstep is untouched.

### Key facts from exploration
- Compensation lives inline on `staffEmployment` (`src/lib/db/staff-schema.ts`),
  effective-dated: current state = latest `effectiveFromDate` per `staffId`
  (tie-break `createdAt`). Fields: `base`, `hourlyRate`, `guaranteedBonus`,
  `discretionaryBonus`, `currency` + dimensions `role`, `lineOfBusiness`,
  `employmentType`. Filter dimensions all live on this row.
- Latest-row-per-staff pattern already exists in
  `src/actions/staff/getStaffDirectory.ts` (two queries + `firstPerKey` from
  `@/lib/collections`) — mirror it.
- Currencies: `CURRENCY = ["CAD","USD","GBP","EUR","AED"]` (`src/lib/currency.ts`,
  pure, with `formatMoney`). **Frankfurter supports CAD/USD/GBP/EUR but NOT AED.**
  AED is pegged to USD at **3.6725 AED = 1 USD** — inject that as a fixed rate.
- No FX/exchange-rate code and no external-HTTP pattern exist yet — this establishes both.
- Segmented control = `ToggleGroup` + `ToggleGroupItem` with `variant="outline"
  spacing={0}` (`src/components/ui/toggle-group.tsx`); single-select pattern in
  `src/components/admin/table-filters.tsx` (also has `SelectFilter`, `FilterLabel`).
- Home page (`src/app/(app)/page.tsx`) has an inline KPI-card pattern to extract from.
- Nav is `NAV_ITEMS` in `src/components/app-shell/nav.ts`; **no per-role nav filtering
  exists yet** — we add a minimal, serializable mechanism.

## Implementation

### 1. FX: pure conversion helper — `src/lib/fx.ts` (new, pure/client-importable)
- `export const AED_PER_USD = 3.6725;`
- `export const FALLBACK_USD_RATES: Record<Currency, number>` — approximate USD-based
  rates (USD→X) used only when the live fetch fails, so the page still renders.
- `convert(amount, from, to, usdRates)` — `usdRates` is a base-USD table (USD→X). Any
  `from`→`to` = `amount / usdRates[from] * usdRates[to]`. `usdRates.USD === 1`.
- Small unit test `src/lib/fx.test.ts` (identity, cross-currency, AED via peg).

### 2. Exchange rates read — `src/actions/staff/getExchangeRates.ts` (new, `server-only`)
- Fetch `https://api.frankfurter.dev/v1/latest?base=USD`; merge in `AED: AED_PER_USD`
  and `USD: 1`. Return `{ rates: Record<Currency, number>, asOf: string, stale: boolean }`.
- On fetch/parse failure → return `FALLBACK_USD_RATES` with `stale: true` (page shows a
  subtle "rates unavailable, using fallback" note; never throws).
- **Cache the fetch ~daily.** Rates update once per business day. **Before writing the
  cache call, read `node_modules/next/dist/docs/` for this pinned Next build's
  data-fetching/caching API** (`fetch` `next: { revalidate }` vs `unstable_cache`) —
  don't assume public-Next behavior (`.claude/rules/nextjs.md`).

### 3. Compensation data read — `src/actions/staff/getCompensationSummaryData.ts` (new, `server-only`)
- **Gate first:** `getCurrentUser()` → `requirePermission(user, { staff:
  ["viewCompensation"] })` (defense in depth alongside the page gate).
- Return **anonymized** latest-employment rows for **active** staff only — dimensions +
  amounts, **no id/name/email**: `{ role, lineOfBusiness, employmentType, base,
  guaranteedBonus, hourlyRate, currency }[]`. Anonymized rows minimize exposure while
  still enabling arbitrary client-side filter/currency recompute. (Viewer already holds
  `viewCompensation`, so this is not new exposure.)
- Mirror `getStaffDirectory` two-query + `firstPerKey` latest-row logic; join `staff`
  to filter `isActive`; **project explicit columns only** (`.claude/rules/database.md`).
- Export `performanceFilterOptions` (lineOfBusiness / role / employmentType arrays from
  the enums), like `staffDirectoryFilterOptions`, so the page/UI never import Drizzle.

### 4. Pure stats helper — `src/lib/performance-stats.ts` (new, pure) + test
- Input: rows already normalized to the target currency (comp + hourly as numbers).
- `computeGroupStats(rows)` → `{ headcount, avgComp, minComp, maxComp, avgHourly,
  minHourly, maxHourly }` (nulls for empty groups).
- `computeByRole(rows)` → overall + a map/array keyed by role.
- Unit test `src/lib/performance-stats.test.ts` (averages, min/max, empty group).

### 5. Page — `src/app/(app)/performance/page.tsx` (new, Server Component)
- `export const metadata` (tab title). Standard shell: `mx-auto max-w-5xl flex
  flex-col gap-6`, own `<h2>`.
- Gate: `getCurrentUser()`; if `!userHasPermission(user, { staff:
  ["viewCompensation"] })` → `notFound()`.
- `await Promise.all([getCompensationSummaryData(), getExchangeRates()])`; pass rows +
  rate table + `performanceFilterOptions` to the client component.

### 6. Client dashboard — `src/components/performance/performance-dashboard.tsx` (new, `"use client"`)
- Filter state: `lineOfBusiness`, `role`, `employmentType` (each with an `ALL`
  sentinel, default `ALL`), plus `currency` (`"CAD" | "USD"`, default CAD).
- Render filters as segmented `ToggleGroup`s (reuse the single-select pattern from
  `table-filters.tsx`; a shared segmented-filter component can be lifted if cleaner).
  Note: role has 9 values → let the role toggle wrap or scroll horizontally; if too
  wide it may fall back to `SelectFilter`. Currency toggle is its own 2-option segment.
- `useMemo`: filter rows → `convert()` each comp (`base+guaranteedBonus`) and
  `hourlyRate` into the selected currency using the rate table → `computeByRole`.
- Overall figures → KPI cards (extract `StatCard` from the Home pattern into
  `src/components/performance/stat-card.tsx`). By-role figures → a breakdown table
  (`src/components/ui/table.tsx`): one row per role + an "All" total row; columns for
  headcount, avg comp, comp range, avg hourly, hourly range. Format money with
  `formatMoney(value, currency)`. Show the `stale`/`asOf` FX note subtly.

### 7. Nav (with a minimal, generic permission filter) — `src/components/app-shell/nav.ts` + `app-sidebar.tsx` + `(app)/layout.tsx`
- Add `{ title: "Performance", href: "/performance", icon: IconReportMoney /* or
  IconChartBar */ }` to `NAV_ITEMS`, with a new optional field on `NavItem`, e.g.
  `permission?: PermissionCheck`, set to `{ staff: ["viewCompensation"] }`.
- Since the sidebar is a client component that imports `NAV_ITEMS` (icons must stay
  client-side, not serialized): in `(app)/layout.tsx` (server, has `user`) compute
  `visibleNavHrefs: string[]` by evaluating each item's `permission` via
  `userHasPermission`, and pass that **string array** through `AppShell` →
  `AppSidebar`. The sidebar filters `NAV_ITEMS` to `visibleNavHrefs`. Only serializable
  strings cross the boundary; permission logic stays in `permissions.ts` helpers.
- This makes the sidebar permission-aware generically (reusable for future gated pages)
  — a small improvement worth flagging to the user.

## Files
- New: `src/lib/fx.ts` (+ `fx.test.ts`), `src/lib/performance-stats.ts`
  (+ `performance-stats.test.ts`), `src/actions/staff/getExchangeRates.ts`,
  `src/actions/staff/getCompensationSummaryData.ts`,
  `src/app/(app)/performance/page.tsx`,
  `src/components/performance/performance-dashboard.tsx`,
  `src/components/performance/stat-card.tsx`.
- Edit: `src/components/app-shell/nav.ts`, `src/components/app-shell/app-sidebar.tsx`,
  `src/components/app-shell/app-shell.tsx` (thread `visibleNavHrefs`),
  `src/app/(app)/layout.tsx` (compute `visibleNavHrefs`).

## Verification
- `bun run check` (Biome + `tsc` + tests) — must pass, incl. the new `fx` and
  `performance-stats` unit tests. `bun run build` for the non-trivial page.
- `bun run dev` and, signed in as **finance/manager/admin**:
  - `/performance` renders; overall KPI cards + by-role table populate.
  - Toggle **CAD ↔ USD** → all figures rescale (seed data spans all 5 currencies, so
    this exercises frankfurter for CAD/USD/GBP/EUR and the **AED peg** path).
  - Apply each filter (line of business / employment type / role) → stats recompute;
    "All" default shows everyone.
  - Simulate a rates fetch failure → page still renders via fallback with the stale note.
- Signed in as a plain **`user`**: Performance nav item is **hidden**, and visiting
  `/performance` directly **404s** (read also refuses via `requirePermission`).
- After merge: dispatch the **librarian** subagent to update
  `docs/domains/performance.md` (new analytics slice) and note the new FX/external-HTTP
  pattern in architecture docs.

## Notes / flags
- **AED** is not on frankfurter — handled via the fixed USD peg (3.6725). If real data
  ever carries a currency outside frankfurter's 30 + AED, `convert` should treat a
  missing rate as unconvertible (skip with a logged warning) rather than silently 1:1.
- Adding permission-aware nav filtering is a **new generic capability** for the sidebar
  (previously every signed-in user saw every nav item). Intentional and reusable.
