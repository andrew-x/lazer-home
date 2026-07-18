/**
 * Staff rating levels (L0–L4) — the overall performance level assigned to a
 * person. Declared here as a pure, client-importable module (no `db`/drizzle) so
 * the schema's zod validation, the edit form's dropdown, and every display share
 * exactly one source of truth (mirrors `@/lib/feedback-rating`; see ADR 0016 on
 * the shared-enum convention).
 *
 * A level is stored as an integer 0–4; `null`/absent means the person is unrated.
 * Levels are always shown with an `L` prefix (`L0`…`L4`).
 */

export const MIN_RATING_LEVEL = 0;
export const MAX_RATING_LEVEL = 4;

/** The valid levels, low → high. The single source for options and ordering. */
export const RATING_LEVELS = [0, 1, 2, 3, 4] as const;

export type RatingLevel = (typeof RATING_LEVELS)[number];

/** True for an integer that is a valid rating level (0–4). */
export function isRatingLevel(value: unknown): value is RatingLevel {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_RATING_LEVEL &&
    value <= MAX_RATING_LEVEL
  );
}

/** Display label for a single level. `null` (unrated) → "Unrated". */
export function formatLevel(level: number | null): string {
  return level == null ? "Unrated" : `L${level}`;
}

/**
 * Display label for an averaged level (a non-integer mean), to one decimal with
 * the `L` prefix, e.g. `L2.3`. `null` (no rated staff) → an em dash.
 */
export function formatAverageLevel(average: number | null): string {
  return average == null ? "—" : `L${average.toFixed(1)}`;
}

/**
 * The "no rating" sentinel for a string-valued Select (Base UI Select values are
 * strings). Editors hold the level as `encodeLevelValue(level)` and decode on save
 * — keeping the draft a plain string, exactly like the other bulk-edit dropdowns.
 */
export const UNRATED_SELECT_VALUE = "none";

/** Encode a level (or null) as the edit form's Select string value. */
export function encodeLevelValue(level: number | null): string {
  return level == null ? UNRATED_SELECT_VALUE : String(level);
}

/** Decode the edit form's Select string value back to a level or null. */
export function decodeLevelValue(value: string): number | null {
  return value === UNRATED_SELECT_VALUE ? null : Number(value);
}
