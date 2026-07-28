/**
 * Per-role rating subrating rubrics — the categories a person is scored on
 * alongside their overall level, and the valid subrating values (L1–L4).
 *
 * Declared here as a pure, client-importable module (no `db`/drizzle) so the
 * schema's typed jsonb column, the edit grid's dropdowns, and the save action's
 * key validation all share one source of truth (mirrors `@/lib/staff/staff-rating`
 * and `@/lib/staff/skills`; see ADR 0016 on the shared-enum convention).
 *
 * The rubric differs per role and is owned entirely by this module — there is no
 * DB enum for the categories, so adding or changing a rubric is a code-only
 * change (no migration). Subratings are stored as `Record<categoryKey, level>`
 * jsonb on `staff_rating`; the shape is validated at the zod layer, not the DB
 * (the same pattern as the survey `responses` table).
 *
 * Subrating levels reuse the `L`-prefix display + string codec from
 * `@/lib/staff/staff-rating` (range-agnostic), but the scale is L1–L4 with no L0
 * — a category is either scored 1–4 or left unset ("No rating").
 */

import type { Role } from "@/lib/staff/staff-enums";

export const SUBRATING_MIN = 1;
export const SUBRATING_MAX = 4;

/** The valid subrating levels, low → high. Single source for options/ordering. */
export const SUBRATING_LEVELS = [1, 2, 3, 4] as const;

export type SubratingLevel = (typeof SUBRATING_LEVELS)[number];

/** A person's subratings: category key → level (1–4). Absent key = unset. */
export type Subratings = Record<string, number>;

/**
 * One scored dimension within a role's rubric. `short` is a compact label for
 * tight surfaces (read-only chips in the roster); falls back to `label`.
 */
export type RubricCategory = { key: string; label: string; short?: string };

/**
 * The subrating rubric per role. Only roles present here have subratings; the
 * rest fall through to `[]` (overall level only). Keys are stable identifiers
 * stored in the jsonb — do not rename a key without a data migration; change the
 * `label` freely.
 */
export const ROLE_RUBRICS: Partial<Record<Role, readonly RubricCategory[]>> = {
  ENGINEER: [
    { key: "communications", label: "Communications", short: "Comms" },
    {
      key: "project_management",
      label: "Project management",
      short: "Proj mgmt",
    },
    {
      key: "relationship_management",
      label: "Relationship management",
      short: "Rel mgmt",
    },
    {
      key: "outcomes_ownership",
      label: "Outcomes ownership",
      short: "Outcomes",
    },
    { key: "technical_depth", label: "Technical depth", short: "Tech depth" },
    {
      key: "technical_breadth",
      label: "Technical breadth",
      short: "Tech breadth",
    },
    { key: "output_craft", label: "Output craft", short: "Craft" },
    {
      key: "ai_tooling_competency",
      label: "AI tooling competency",
      short: "AI tooling",
    },
  ],
};

/** The rubric for a role, or `[]` when the role (or `null`) has no rubric. */
export function rubricForRole(role: Role | null): readonly RubricCategory[] {
  return (role && ROLE_RUBRICS[role]) || [];
}

/** Every rubric category across all roles, deduped in first-seen order. */
export const ALL_RUBRIC_CATEGORIES: readonly RubricCategory[] = (() => {
  const seen = new Map<string, RubricCategory>();
  for (const categories of Object.values(ROLE_RUBRICS)) {
    for (const category of categories ?? []) {
      if (!seen.has(category.key)) seen.set(category.key, category);
    }
  }
  return [...seen.values()];
})();

/** The union of every rubric key — the flat field list for the edit grid. */
export const ALL_RUBRIC_KEYS: readonly string[] = ALL_RUBRIC_CATEGORIES.map(
  (c) => c.key,
);

/** Label per rubric key, for the edit grid's field labels / confirm dialog. */
export const RUBRIC_LABELS: Record<string, string> = Object.fromEntries(
  ALL_RUBRIC_CATEGORIES.map((c) => [c.key, c.label]),
);

/**
 * Keep only rubric keys valid for `role` (dropping unknown or stale keys a
 * crafted payload might carry), returning `null` when nothing survives — so "no
 * subratings" is stored consistently as null rather than `{}`.
 *
 * The rubric is role-specific, so the zod layer can only validate the *values*
 * (1–4); which *keys* are legitimate depends on the person's current role and is
 * therefore only knowable server-side. Every write path that persists subratings
 * must run them through here against a freshly-read role — this is load-bearing
 * validation, not tidying.
 */
export function sanitizeSubratings(
  subratings: Subratings | null | undefined,
  role: Role | null,
): Subratings | null {
  if (!subratings) return null;
  const allowed = new Set(rubricForRole(role).map((c) => c.key));
  const clean: Subratings = {};
  for (const [key, value] of Object.entries(subratings)) {
    if (allowed.has(key)) clean[key] = value;
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/**
 * Stable serialization (sorted keys) so two subrating objects compare by value,
 * not by key insertion order. Used to detect genuine changes — a no-op write
 * must not spawn a new dated rating row.
 */
export function canonicalSubratings(
  subratings: Subratings | null | undefined,
): string {
  if (!subratings) return "";
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(subratings).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}
