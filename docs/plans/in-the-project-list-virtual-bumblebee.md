# Project list: margin field + derived risk tags

## Context

The projects list (`/projects`) today shows each project as a card with two badges
(derived status, lines of business) and two facts (delivery managers, date range).
The commercial layer — budget, revenue, cost, margin — exists but lives **only** on
the project detail page, so nothing about a project's money is visible while
scanning the list. You can't tell which engagements are thin or under water without
opening them one at a time.

This change makes the list commercially useful:

1. **Margin becomes a field on the card**, with a CAD/USD display control
   (defaulting to CAD) for the whole list.
2. **The badge row stops carrying status and line of business** — those become plain
   fields in the card's definition list — and instead carries **derived risk tags**:
   `Ending soon`, `Negative margin`, `Low margin`.
3. **The tag thresholds become config variables** in one reviewed, pure module, so
   changing "low margin" or "ending soon" is a one-line edit, not a hunt.

No schema change: everything is derived from existing columns, so there is no
migration and no seed change.

### Decisions already made

- **Low margin = OR**: `marginPercent < 25%` **or** `margin < 10,000`. A small
  project with a healthy percentage still gets flagged — that's intended.
- **`Negative margin` is its own tag** for margin ≤ 0, and it **suppresses**
  `Low margin` (strictly worse; both would be noise).
- **Status and line of business both stay on the card**, as `<dl>` fields. The
  search/filter view is a flat grid across all statuses, so dropping status there
  would lose information the grouped view gets from its section headings.
- **Display currency is a client control** (CAD default), but **flags are evaluated
  server-side against a fixed threshold currency (CAD)** so a project's tags never
  change because someone flipped the toggle. Consequence to accept: viewing in USD,
  a card can read "$7,400" and carry `Low margin` (CA$10,100 → over the CAD floor,
  under nothing else) — the tag describes the project, not the rendering.

### RBAC consequence (not negotiable)

Cost — and therefore margin — is gated on **`projects.viewMargin`**
(`src/lib/auth/permissions.ts:33`), enforced in the read by
`getProjectCostBasis` returning `null`. So for `sales` and `user`:

- no `Margin` row on the card,
- **no `Low margin` / `Negative margin` tags** (they'd leak the fact),
- no currency toggle (nothing to convert).

`Ending soon` is not compensation-derived and shows for everyone. The gate stays in
the read; nothing compensation-derived is sent to a client that merely hides it.

---

## Implementation

### 1. New config + tag module — `src/lib/projects/project-flags.ts`

A pure, client-importable module (no `db`, no React), following the
`src/lib/projects/bill-rates.ts` / `src/lib/performance/compensation-targets.ts`
convention: a "why code and not a table" header plus a `*_REVIEWED_ON` stamp. Its
tag machinery mirrors `src/lib/crm/company-status.ts` (canonical tuple → labels →
predicates → `…Tags()` filter).

Config variables (the thresholds you asked to centralize):

```ts
export const PROJECT_FLAGS_REVIEWED_ON = "2026-07-30";

/** A project is "ending soon" within this many days of its last role's end. */
export const ENDING_SOON_DAYS = 14;
/** Margin at or below this is "negative" — a loss, not merely thin. */
export const NEGATIVE_MARGIN_AT_OR_BELOW = 0;
/** Below either of these, plan margin is "low". */
export const LOW_MARGIN_PERCENT = 0.25;
export const LOW_MARGIN_AMOUNT = 10_000;
/** The currency the amount thresholds are denominated in — and the currency the
 *  flags are always evaluated in, so they don't move with the display toggle. */
export const MARGIN_FLAG_CURRENCY: DisplayCurrency = "CAD";
```

Then, in canonical (worst-first) order:

```ts
export const PROJECT_FLAGS = ["negativeMargin", "lowMargin", "endingSoon"] as const;
export type ProjectFlag = (typeof PROJECT_FLAGS)[number];
export const PROJECT_FLAG_LABELS: Record<ProjectFlag, string>;   // "Negative margin", …
export const PROJECT_FLAG_VARIANTS: Record<ProjectFlag, "destructive" | "secondary">;

export type ProjectFlagInputs = {
  status: ProjectRoleStatus;         // the project's derived status
  endDate: string | null;            // latest role end, "YYYY-MM-DD"
  today: string;
  /** Margin in MARGIN_FLAG_CURRENCY. Null ⇒ unknown or withheld ⇒ no margin flag. */
  margin: { margin: number | null; marginPercent: number | null } | null;
};
export function projectFlags(input: ProjectFlagInputs): ProjectFlag[];
```

Rules:

- `endingSoon` — `status !== "cancelled"`, `endDate` is set, and
  `today <= endDate <= addDays(today, ENDING_SOON_DAYS)`. Lexicographic date
  comparison is valid for `YYYY-MM-DD`; reuse `addDays` from
  `src/lib/timesheets/timesheet-week.ts` (already imported cross-domain by
  `src/lib/allocations/allocations-grid.ts`).
- `negativeMargin` — `status !== "cancelled"` and `margin.margin != null` and
  `margin.margin <= NEGATIVE_MARGIN_AT_OR_BELOW`.
- `lowMargin` — not `negativeMargin`, `status !== "cancelled"`,
  `margin.margin != null`, and
  (`marginPercent != null && marginPercent < LOW_MARGIN_PERCENT`) **or**
  `margin.margin < LOW_MARGIN_AMOUNT`.
- A cancelled project gets no margin flags — the work will never be delivered or
  billed. A **past** project still gets them (truthful, and that section is
  collapsed by default).
- Unknown margin (`null` amount: no budget set, or every role's cost unknown) never
  produces a flag — "we don't know" is not "it's bad".

Add `src/lib/projects/project-flags.test.ts` (bun test). ADR 0053 already sanctions
unit tests for margin logic as an exception to ADR 0037, and thresholds with an OR
plus a suppression rule are exactly the shape that rots silently. Cover: each
threshold boundary, the OR, negative suppressing low, cancelled, null margin, and
the ending-soon window edges (today, +14, +15).

### 2. Per-request margin context — `src/actions/projects/getProjectsMarginContext.ts`

`import "server-only"`, wrapped in React `cache()` (the convention already used by
`getStaffProfile`, `getCompanyDetail`, …). Returns once per request:

```ts
{ rates: ExchangeRates; costBasis: PlanCostBasis | null; nativeCurrencies: Currency[] }
```

- `getExchangeRates()` (`src/actions/staff/getExchangeRates.ts`) — already 12h
  fetch-cached.
- `getProjectCostBasis({ staffIds, usdRates })` — **the only sanctioned entry to
  cost**; `null` means no `viewMargin`. `staffIds` = one small
  `selectDistinct(projectRoles.staffId)` query (staff actually on a project role),
  not all staff.
- `nativeCurrencies` = the distinct currencies a rate could be applied to:
  `selectDistinct(projects.budgetCurrency)` ∪ `BILL_RATE_CURRENCY` ∪ the currencies
  in `costBasis.staffHourlyCost` (omitted when `costBasis` is null — nothing on the
  cost side is converted then). Feeds the FX note beside the toggle.

**Why cached:** `GroupedView` (`page.tsx:116`) fires five list reads in parallel, and
`getRoleTypeAverageCostsUsd` scans all of `staff_employment`. `cache()` memoizes the
promise, so concurrent callers share one fetch instead of five.

### 3. `src/actions/projects/getProjectsList.ts`

`ProjectListItem` gains:

```ts
billingType: BillingType | null;          // so the card can say "No budget" honestly
flags: ProjectFlag[];
/** Plan margin per display currency. Null ⇒ viewer lacks projects.viewMargin. */
margin: Record<DisplayCurrency, ProjectListMargin> | null;
```

with `export type ProjectListMargin = { margin: number | null; marginPercent: number | null }`.

Query changes — **no new queries, no N+1**:

- Both base selects (`~:251`, `~:291`) add `billingType`, `budgetAmount`,
  `budgetCurrency`.
- The existing role query (`~:195`) adds `id`, `roleType`, `hoursPerDay`, `staffId`
  (it already selects status/dates), and `assembleRows` collects
  `MarginRoleInput[]` per project alongside the maps it already builds.

`assembleRows` then, once per row:

- `await getProjectsMarginContext()` (hoisted above the loop; cached anyway).
- When `costBasis !== null`, call `computeProjectMargin` from
  `src/lib/projects/project-margin.ts` once per entry in `DISPLAY_CURRENCIES` (only
  two) with `includeCost: true`, `usdRates: rates.rates`, and per-role
  `staffHourlyCost` looked up exactly as `use-project-margin.ts:54` does. Keep only
  `totals.margin` / `totals.marginPercent`. When `costBasis === null`, set
  `margin: null` and skip the compute entirely.
- `flags: projectFlags({ status, endDate, today: currentDay(), margin: margin?.[MARGIN_FLAG_CURRENCY] ?? null })`.

**Why precompute both currencies server-side** rather than shipping native amounts
and recomputing on the client (ADR 0029's approach for the detail page): there are
only two display currencies, so two numbers per project is far less payload than
every role's hours/type/assignee — and, more importantly, it means **no per-person
hourly cost is sent to the browser for the list at all**. The detail page needs
per-role cost for its table; the list doesn't. Worth an ADR note.

Cost of doing it twice: `roleBillableHours` runs `countWorkingDays` per role per
currency. Fine at list scale (a page is ≤ `CRM_PAGE_SIZE`; the Active section is
unpaginated but bounded by the real number of live projects) — but if the Active
section ever gets large this is the first place to look.

### 4. Currency control — `src/components/projects/projects-currency.tsx`

`"use client"`. Exports:

- `ProjectsCurrencyProvider` — context holding
  `useState<DisplayCurrency>(PROJECTS_LIST_DEFAULT_CURRENCY /* "CAD" */)`. Wraps the
  whole list region so the toggle in the header and the cards in five separate
  server-rendered sections share one value, with no refetch on toggle.
- `useProjectsCurrency()` — read by `ProjectCard`.
- `ProjectsCurrencyToggle` — the same `ToggleGroup` + `FxRateNote` pairing as
  `budget-summary-panel.tsx:97-119` (including the `toEnumValue` guard for Base UI's
  empty-array-on-repress). Pass `from={nativeCurrencies.filter(c => c !== displayCurrency)}`;
  `FxRateNote` renders nothing when that's empty.

### 5. `src/components/projects/project-card.tsx`

Becomes `"use client"` (it needs the currency context; it renders only `Link`,
`Card`, `Badge` — nothing server-only).

- Badge row → `project.flags.map(...)` using `PROJECT_FLAG_LABELS` /
  `PROJECT_FLAG_VARIANTS`. `destructive` for `Negative margin`; `secondary` for the
  other two — consistent with "only losses get colour" (`docs/ui.md`, and the
  rationale in `project-margin.ts:179-206`). Render nothing when there are no flags.
- `<dl>` becomes: **Status** (`PROJECT_ROLE_STATUS_LABELS[project.status]`) ·
  **Line of business** (`LINE_OF_BUSINESS_LABELS`, joined — same label the list
  filter uses) · **Delivery** · **Dates** · **Margin**.
- Margin row (omitted entirely when `project.margin === null`):
  `aggregateMoneyFormatters(displayCurrency).money(figure.margin)` plus
  `formatPercent(figure.marginPercent)` in muted text — money leads, percentage
  supports (ADR 0053). Tone via existing `marginAmountTone`. When
  `billingType === null` show a muted "No budget"; when the amount is null despite a
  budget, `money()` already renders "—".
- `ProjectStatusBadge` stays (still used by the detail view and
  `staff-projects-section.tsx`) — the card just stops using it.

### 6. `src/app/(app)/projects/page.tsx`

- Compute `canViewMargin = user ? userHasPermission(user, { projects: ["viewMargin"] }) : false`
  for **toggle visibility only** (cosmetic — the figures are withheld by the read
  regardless), and `await getProjectsMarginContext()` for `rates` /
  `nativeCurrencies`.
- Wrap the list region in `ProjectsCurrencyProvider`, and render
  `ProjectsCurrencyToggle` in the filters row (right-aligned, sibling of
  `ProjectsListFilters`) when `canViewMargin`. It's a display preference, not a
  filter, so it stays client state rather than a URL param.

---

## Files

| File | Change |
|---|---|
| `src/lib/projects/project-flags.ts` | **new** — thresholds + tag derivation |
| `src/lib/projects/project-flags.test.ts` | **new** — boundaries, OR, suppression |
| `src/actions/projects/getProjectsMarginContext.ts` | **new** — cached rates + cost basis |
| `src/actions/projects/getProjectsList.ts` | budget + role columns; per-currency margin; flags |
| `src/components/projects/projects-currency.tsx` | **new** — provider, hook, toggle |
| `src/components/projects/project-card.tsx` | badge row → flags; dl gains Status / LoB / Margin |
| `src/app/(app)/projects/page.tsx` | provider + toggle wiring |

Reused, not rebuilt: `computeProjectMargin` / `marginAmountTone`
(`lib/projects/project-margin.ts`), `getProjectCostBasis`, `getExchangeRates`,
`FxRateNote`, `aggregateMoneyFormatters`, `formatPercent`, `ToggleGroup` +
`toEnumValue`, `addDays` / `currentDay`, `PROJECT_ROLE_STATUS_LABELS`,
`LINE_OF_BUSINESS_LABELS`.

No schema change ⇒ no `db:generate` / `db:migrate`, and `scripts/seed/` needs no
update.

## Verification

1. `bun run check` (Biome + `tsc --noEmit` + `bun test`, incl. the new flag tests)
   and `bun run build`.
2. `bun run dev` → `/projects` as an admin:
   - Margin shows on cards; toggle flips CAD ↔ USD instantly with no page reload,
     and every card moves together.
   - Cards with a fixed fee, with T&M, and with **no budget** all read sensibly
     ("No budget" rather than a bare "—").
   - The FX note appears beside the toggle and its tooltip names the rates used.
3. Tag spot-checks, using the detail page's budget dialog to force each case on a
   seeded project: set a fixed fee that lands margin just under/over 25%, just
   under/over CA$10,000, and below zero; confirm `Low margin` appears, `Negative
   margin` replaces it (never both), and the tags do **not** change when the toggle
   flips. For `Ending soon`, confirm against a project whose latest role ends inside
   14 days (seed dates will vary — check the Active section, or shorten a role's end
   date in the allocations planner).
4. **RBAC check** — via the admin manage-users screen, view `/projects` as a `sales`
   user: no Margin row, no currency toggle, **no margin tags**, `Ending soon` still
   present. Then confirm nothing compensation-derived is in the payload (view-source
   / RSC payload search for a known salary-derived figure). Run `/audit-rbac`.
5. `/code-review` on the diff.
6. Dispatch the **`librarian`** subagent to reconcile `docs/domains/projects.md` and
   `docs/decisions/0053-project-budgets-and-margin.md` with: list-level margin, the
   derived flag config module, and the deliberate deviation from ADR 0029 (list
   precomputes both display currencies server-side instead of shipping native
   amounts).
