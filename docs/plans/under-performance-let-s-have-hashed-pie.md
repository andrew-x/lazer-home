# Staff Ratings / Levels (L0–L4)

## Context

The performance domain today has two slices: peer feedback and the compensation &
headcount dashboard (`/performance`). We want to add a **rating** (level) for each
staff member — an overall level **L0–L4** — as the first real "performance evaluation"
primitive.

- A level is an integer **0–4**, displayed with an **`L` prefix** (`L0`…`L4`). `0–4`
  are the only valid values.
- Staff can have **no rating** (unrated) — either never evaluated or explicitly set
  back to none.
- Levels are **effective-dated**: saving an evaluation records a **dated snapshot** so
  we keep a **history** of past ratings per person (mirrors how compensation is modeled
  via `staffEmployment`, ADR 0007).
- Ratings are **sensitive**: visible only to **managers and admins**; staff never see
  their own or others' ratings. Managers **and** admins can edit/save evaluations.
- Surfaced as **tabs under `/performance`**: a "Levels" dashboard (breakdown +
  distribution bar chart) and an edit page.

Everything below reuses existing patterns; the only genuinely new modeling is the
rating table itself.

## Design decisions

- **Storage:** a new effective-dated table `staffRating` (one dated row per staff per
  evaluation). "Current level" = latest row per staff; `level` is **nullable** so
  un-rating is a real, historied event. No rows for a staffer ⇒ unrated.
- **Access:** new capability resource `ratings: ["view", "edit"]` granted to
  **manager + admin only** (NOT finance). Gates the dashboard read, the edit read, and
  the save action. `/performance` page-level gate stays `staff.viewCompensation`; the
  **Levels tab and its routes are gated on `ratings.view`** so finance keeps seeing only
  Compensation.
- **Average level:** mean of the numeric current levels over **rated** staff only
  (unrated excluded), displayed to one decimal with the `L` prefix (e.g. `L2.3`).

## Data model

**`src/lib/db/performance-schema.ts`** — add `staffRating` alongside `feedback`:

- `id` text PK (`generateId("rating")`, `src/lib/db/ids.ts`)
- `staffId` text FK → `staff.id`, `onDelete: "cascade"`
- `level` `integer()` **nullable** (0–4; null = explicitly unrated)
- `effectiveDate` `date().notNull()` (string mode `"YYYY-MM-DD"`)
- `evaluatedByUserId` text FK → `user.id`, nullable (who saved it — audit; optional but cheap)
- `createdAt` / `updatedAt` with `$onUpdate` (copy from `staffEmployment`)

Export `type StaffRating = InferSelectModel<typeof staffRating>`. Optional DB check
constraint `level between 0 and 4`.

**`src/lib/staff-rating.ts`** (new, **pure/client-safe** — no drizzle; mirrors
`src/lib/feedback-rating.ts`, ADR 0016): `RATING_LEVELS = [0,1,2,3,4] as const`,
`RatingLevel` type, `MIN_RATING_LEVEL`/`MAX_RATING_LEVEL`, `formatLevel(level: number
| null): string` (`null → "Unrated"`, else `` `L${level}` ``), `formatAverageLevel(n:
number | null)` (`` `L${n.toFixed(1)}` ``), `isRatingLevel(n)`. This is the single
source of truth the pgEnum-adjacent zod schema and all UI import.

**Effective-dating query fragment:** define `latestRatingFirst = [desc(effectiveDate),
desc(createdAt)]` next to the reads (server-only; keep it out of the pure module so no
drizzle leaks into the client bundle — same split as `src/lib/staff-employment.ts`).
Resolve current level with `.orderBy(...latestRatingFirst)` + `firstPerKey(rows, r =>
r.staffId)` (`@/lib/collections`) — two queries, no N+1.

After schema edits: `bun run db:generate` → `bun run db:migrate`.

## Permissions (lockstep — all three or none)

- `src/lib/permissions.ts`: add `ratings: ["view", "edit"]` to `statement`; add
  `ratings: ["view", "edit"]` to the **manager** and **admin** role objects only.
  `PermissionCheck` auto-derives — no other wiring.
- `src/lib/permissions.test.ts`: extend the matrix assertions — manager/admin get both
  ratings keys; user/sales/delivery-manager/**finance** get neither.
- `docs/domains/permissions.md`: add the `ratings` rows to the documented matrix.
- Verify with `/audit-rbac` and `bun run check` (runs the matrix test).

## Server layer (actions)

Follow `.claude/rules/server-actions.md`: reads are `import "server-only"` plain async
`get*` functions; the mutation is a `secureActionClient` action with a metadata gate.
Pages/components never import `db`.

**Reads (`src/actions/performance/` — new folder, or `src/actions/staff/`):**

- `getRatingsSummaryData.ts` — gate `requirePermission(user, { ratings: ["view"] })`.
  For each **active** staff (`eq(staff.isActive, true)`), join current level (latest
  `staffRating`) with current comp (latest `staffEmployment`, `latestEmploymentFirst` +
  `firstPerKey`). Return **anonymized** rows `{ level: number | null, role,
  lineOfBusiness, employmentType, base, guaranteedBonus, hourlyRate, currency }` (no
  id/name/email) — mirrors `getCompensationSummaryData.ts`. Client normalizes comp via
  FX and groups by level.
- `getStaffRatingsForEdit.ts` — gate `ratings.view`. One row per active staff:
  `{ staffId, name, role, currentLevel: number | null }`. Mirrors
  `getStaffEmploymentForEdit.ts`.

**Mutation:**

- `src/actions/performance/saveStaffEvaluation.ts` (`'use server'`) +
  `saveStaffEvaluation.schema.ts`. `metadata: { action, permission: { ratings:
  ["edit"] } }`. Input `{ changes: { staffId: id, level: z.number().int().min(0).max(4)
  .nullable() }[], effectiveDate?: dateString }` (default today). In a
  `db.transaction`: re-read current level per changed staff, **drop no-ops**, insert a
  new dated `staffRating` row for each real change (set `evaluatedByUserId` from
  session), `revalidatePath("/performance/levels")`. Template:
  `src/actions/admin/commitBulkEditEmployment.ts` (but use `secureActionClient` + the
  permission gate, **not** `publicActionClient`/`assertLocalhost`).

## Stats (pure, client-run, unit-tested)

- **Reuse `src/lib/performance-stats.ts` `computeByRole(rows, order)`** for the
  comp/rate-per-level table: tag each `StatRow.role` with the level label (`formatLevel`)
  and pass `["L0","L1","L2","L3","L4"]` as `order`. Gives per-level headcount, avg comp,
  comp range, avg hourly, hourly range for free. (No change to that module.)
- **New `src/lib/rating-stats.ts`** (+ `rating-stats.test.ts`) for level-specific math:
  `computeLevelDistribution(levels)` → count per L0–L4 (bar chart), `countUnrated`,
  `computeAverageLevel(levels)` (rated only, `null` if none), `computeAverageLevelByRole
  (rows, roleOrder)`.

## UI

Base UI / shadcn conventions (`.claude/rules/ui.md`): `render` prop not `asChild`,
Tabler icons, sharp corners, flat surfaces, `cn()`. Add primitives via `bunx --bun
shadcn@latest add <name>` only if missing (Select/Table/Card/Tabs already exist).

**Cross-route tab bar** — small shared component (nav links, permission-filtered)
rendered on `/performance` and `/performance/levels*`: **Compensation** (if
`viewCompensation`) | **Levels** (if `ratings.view`). Use `src/components/ui/tabs.tsx`
styling or a segmented link bar.

**Levels dashboard** `src/components/performance/levels-dashboard.tsx` (`"use client"`):
- Headline `StatCard`s (`src/components/performance/stat-card.tsx`): total active,
  **unrated count**, **overall avg level** (`formatAverageLevel`).
- **Distribution bar chart** `src/components/performance/level-distribution-bar-chart.tsx`
  — **hand-rolled inline SVG** (no chart lib — deliberate, `docs/ui.md`). One bar per
  L0–L4, **zero baseline**, `fill-primary`, per-bar `<title>` showing the count on hover,
  `role="img"` + `aria-label`. Template: `src/components/performance/compensation-scatter.tsx`.
- **Breakdown-by-level table** (`src/components/ui/table`): Level | Headcount | Avg comp
  | Comp range | Avg rate | Rate range, with an "All levels" `TableFooter`. Same layout
  as the by-role table in `performance-dashboard.tsx`; `formatMoney(..., {maximumFraction
  Digits:0})`, em dash for null.
- **Avg level per role** table/list from `computeAverageLevelByRole`.
- Currency toggle CAD/USD + FX normalization in a `useMemo` (reuse `@/lib/fx` `convert`,
  `getExchangeRates`, `ROLE_LABELS`). Filters (LOB/type/role) optional — reuse
  `src/components/form/filters.tsx` if included.
- **"Edit levels" button** (top-right / `CardAction`) → `/performance/levels/edit`
  (`<Button render={<Link href="/performance/levels/edit" />}>`).

**Edit page** `src/components/performance/edit-levels.tsx` (`"use client"`):
- Reuse `useEditableRows` + `EditableTable` (`src/components/admin/editable-table.tsx`);
  template `src/components/admin/bulk-edit-roles.tsx`. Columns: **Name** (link) + **Level**
  `Select` cell (`EnumCell`-style) with options `L0`–`L4` + **"No rating"**. Draft value
  a string (`"0"…"4"` / `"none"`), mapped to `number | null` on save.
- Built-in **save-on-dirty** floating bar + confirm-diff dialog come from `EditableTable`.
  Commit via `useAction(saveStaffEvaluation, { onSuccess: toast + editable.reset() +
  router.refresh() })`, wired to `onSave` / `isSaving`.

**Pages (modified Next build — read `node_modules/next/dist/docs/` before touching Next
APIs; server component fetches via actions layer → passes plain data to client):**
- `src/app/(app)/performance/page.tsx` (existing) — keep `staff.viewCompensation` gate;
  add the tab bar above the existing comp dashboard.
- `src/app/(app)/performance/levels/page.tsx` (new) — gate `ratings.view` →
  `notFound()`; `Promise.all([getRatingsSummaryData(), getExchangeRates()])`; render tab
  bar + `<LevelsDashboard />`. `export const metadata`.
- `src/app/(app)/performance/levels/edit/page.tsx` (new) — gate `ratings.edit` →
  `notFound()`; `getStaffRatingsForEdit()`; render `<EditLevels />` with a back link.

No new top-level nav item (the existing Performance item stays gated on
`viewCompensation`; managers/admins reach it and see the Levels tab).

## Seed

`scripts/seed/performance.ts`: add `seedRatings(db, staff)` — for active staff, assign a
weighted level (leave ~15–25% unrated), and give some staff 1–2 **earlier** dated rows
so history is non-trivial. Wire into `scripts/seed.ts` after `seedStaff` (needs the
returned staff rows), near `seedFeedback`. Keep it green — the seed imports real schema
so drift breaks `bun run check`.

## Docs

After implementation, **dispatch the `librarian` subagent** to reconcile `/docs`:
update `docs/domains/performance.md` (new ratings slice), confirm
`docs/domains/permissions.md` matrix, and add an **ADR** for the effective-dated rating
model (referencing 0007/0016/0020). The `permissions.md` + `permissions.test.ts` lockstep
edits are part of implementation (must pass `bun run check`), not deferred to the librarian.

## Verification

1. `bun run db:generate && bun run db:migrate` (new table).
2. `bun run check` — Biome + `tsc` + tests, incl. the RBAC matrix test and the new
   `rating-stats.test.ts`. Then `bun run build`.
3. `bun run db:seed` to populate ratings + history.
4. `bun run dev`, sign in as a **manager**: `/performance` shows Compensation + Levels
   tabs; Levels shows the per-level breakdown, avg-level (overall + per role), unrated
   count, and a bar chart whose bars show counts on hover. Open Edit levels, change
   several dropdowns → the Save bar appears → save → confirm the toast, that values
   persist (`router.refresh`), and that a **second** save on a later date preserves prior
   rows (history) rather than overwriting.
5. **RBAC checks:** as **finance**, `/performance` shows only the Compensation tab and
   `/performance/levels` + `/performance/levels/edit` return `notFound()`. As a plain
   **staff/user**, `/performance*` is inaccessible. Confirm no ratings data appears in any
   staff-facing read. `/audit-rbac` clean.
