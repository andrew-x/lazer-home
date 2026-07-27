# Add per-role subratings to performance rating levels

## Context

Today a staffer's performance rating is a single overall **L0–L4 level** — one `integer` on the append-only `staff_rating` table (`src/lib/db/performance-schema.ts:89`), edited on the whole-roster grid at `/performance/levels/edit` (`src/components/performance/edit-levels.tsx`). A single number is too coarse: evaluators want to score people across a **rubric of categories**, and the rubric **differs per role**.

We're adding **subratings**: per-category scores (each **L1–L4**, or unset) captured alongside the overall level. The rubric is role-specific — for **Engineer** it's: communications, project management, relationship management, outcomes ownership, technical depth, technical breadth, output craft, ai tooling competency. Subratings are stored as flexible **JSON** so new rubrics/categories need no migration.

**Decisions locked with the user:**
- **Layout:** in-grid matrix per role. Selecting a single role in the existing Role filter expands the grid so each rubric category becomes a column (compact L1–L4 select per cell), enabling side-by-side comparison and fast fill. When the filter is "All" (or a role with no rubric), only the existing Level column shows.
- **Overall level is independent** — it stays a manually-chosen field; subratings are extra detail with no automatic derivation.
- Each category is L1–L4 **or unset** ("No rating"), so partial evaluations are fine.

## Design

**Storage — one co-dated column, reusing the append-only model (ADR 0007).** Add a nullable `subratings jsonb` column to `staff_rating`, typed `Record<string, number>` (category key → 1–4). Each evaluation still writes one new dated row carrying both `level` and `subratings` together, so subrating history is preserved exactly like the level. This follows the repo's blessed "flexible JSON whose shape is owned by app code, validated at the zod layer, not the DB" pattern (see `src/lib/db/responses-schema.ts` and the `skills` jsonb on `src/lib/db/staff-schema.ts:123`).

**Rubric is app-owned, client-safe.** A new pure module is the single source of truth for which categories exist per role — no DB enum, so adding a rubric is code-only.

**Edit UI reuses the shared engine as-is.** The trick that avoids touching `EditableTable`/`useEditableRows` (`src/components/admin/editable-table.tsx`): **flatten each subrating category into its own string field** in the draft values (alongside `level`), rather than nesting an object. The engine's `isChanged`/diff logic compares fields with `!==`, which works for flat strings but not nested objects. The tracked `fields` array is the **union of `level` + every rubric key across all roles**, so edits are tracked regardless of the current role filter; only the visible *columns* are role-specific. The confirm-diff dialog then lists each changed category for free.

## Changes

### 1. New pure module — `src/lib/performance/rating-rubric.ts`
Client-safe (no drizzle), mirroring `@/lib/staff/skills` and `@/lib/staff/staff-rating`.
- `SUBRATING_MIN = 1`, `SUBRATING_MAX = 4`, `SUBRATING_LEVELS = [1,2,3,4] as const`.
- `type Subratings = Record<string, number>`.
- `type RubricCategory = { key: string; label: string }`.
- `ROLE_RUBRICS: Partial<Record<Role, readonly RubricCategory[]>>` — only `ENGINEER` populated with the 8 categories above (keys like `communications`, `project_management`, `ai_tooling_competency`; `Role` from `@/lib/staff/staff-enums`).
- `rubricForRole(role): readonly RubricCategory[]` → `[]` when none.
- `ALL_RUBRIC_KEYS: readonly string[]` and `RUBRIC_LABELS: Record<string,string>` — union across all roles, for the flattened field list / labels.
- **Reuse** `encodeLevelValue`/`decodeLevelValue`/`UNRATED_SELECT_VALUE`/`formatLevel` from `src/lib/staff/staff-rating.ts` for subrating cells — they're range-agnostic (number↔string, null↔"none"), so no new codec needed. Subrating selects simply offer `No rating` + L1–L4.

### 2. Schema — `src/lib/db/performance-schema.ts`
Add `subratings: jsonb().$type<Subratings>()` to `staffRating` (nullable; `null`/absent = no subratings). Import `jsonb` from `drizzle-orm/pg-core` and `Subratings` from the rubric module (type-only, mirroring how `staff-schema.ts` imports `StaffSkill`). Then `bun run db:generate` → `bun run db:migrate`.

### 3. Save schema — `src/actions/performance/saveStaffEvaluation.schema.ts`
Extend `ratingChangeSchema` with `subratings: z.record(z.string(), z.number().int().min(SUBRATING_MIN).max(SUBRATING_MAX)).optional()`. Keep it hand-written/drizzle-free (client-imported).

### 4. Save action — `src/actions/performance/saveStaffEvaluation.ts`
- Extend the "current state" re-read to fetch each target's **current role** (latest employment) and **current `subratings`** alongside current level (same latest-per-staff join `getStaffRatingsForEdit` already uses).
- **No-op detection:** skip a change only when level is unchanged **and** subratings deep-equal current (small canonical-JSON compare; today it only compares level).
- **Harden keys:** drop any subrating key not in the target's current-role rubric (`rubricForRole`), preventing arbitrary JSON. Insert the sanitized `subratings` into the new dated row.
- Unchanged: `ratings.edit` gate, per-staff new-row insert, `evaluatedByUserId` stamp, revalidate paths.

### 5. Read for edit grid — `src/actions/performance/getStaffRatingsForEdit.ts`
Add `subratings: Subratings` (raw, `{}` when none) to `StaffRatingEditRow`, pulled from the latest rating row.

### 6. Edit UI — `src/components/performance/edit-levels.tsx`
- `EditableValues` becomes a flat string record: `{ level: string } & Record<string, string>` (category key → encoded value). `FIELDS` = `["level", ...ALL_RUBRIC_KEYS]`; `FIELD_LABELS` = `{ level: "Level", ...RUBRIC_LABELS }`.
- `pickEditable(row)` = `{ level: row.level, ...Object.fromEntries(ALL_RUBRIC_KEYS.map(k => [k, encodeLevelValue(row.subratings[k] ?? null)])) }` — every row gets every category field defaulting to `"none"`, so the draft shape is uniform.
- Add a `SubratingCell` (clone of `LevelCell` but options `No rating` + `SUBRATING_LEVELS`, keyed by category).
- Columns: base Name/Role/Level always; when the Role filter selects a single role with a non-empty rubric, append one column per `rubricForRole(role)` category rendering `SubratingCell`. Keep the grid in its `overflow-x-auto` container (already present) for the wide matrix.
- `changes` payload: for each changed row emit `{ staffId, level: decodeLevelValue(...), subratings: {k: decodeLevelValue(v) for each category where v !== "none"} }`.
- `formatValue` already produces `No rating`/L-labels — works for both level and subrating fields, so the confirm-diff dialog lists changed categories with no extra work.

### 7. Seed — `scripts/seed/`
Populate `subratings` on seeded engineer `staff_rating` rows (random L1–L4 across the rubric) so the reseed exercises the column and `bun run check` stays green. Find the rating seed via `grep -rl staffRating scripts/seed`.

### 8. Docs — dispatch `librarian` subagent
After code lands: reconcile `docs/domains/performance.md` and `docs/data-model.md` for subratings; add a short ADR noting the jsonb-per-role-rubric storage decision (why JSON over a normalized subrating table). Do not hand-write docs from the main session.

## Out of scope
No changes to the read-only `/performance` dashboard aggregates (`levels-section.tsx`, `getRatingsSummaryData.ts`) — subratings are edit-only for now. No new permissions; existing `ratings.view`/`ratings.edit` gates and the "staff never see their own ratings" invariant are untouched.

## Verification
- `bun run db:generate && bun run db:migrate`, then `bun run db:seed` — confirm engineer rows get subratings.
- `bun run check` (Biome + tsc + tests) and `bun run build`.
- Optional unit tests: rubric module (`rubricForRole`, key union) and the action's deep-equal no-op path.
- Manual: `/performance/levels/edit` → select **Engineer** in Role filter → the 8 rubric columns appear; set a few L1–L4 values, the save bar counts changes, the confirm dialog lists each changed category old→new; save; reload persists; switch role to "All" and confirm only the Level column shows and prior level history is intact. Verify a non-manager cannot reach the page (`ratings.edit` gate).
