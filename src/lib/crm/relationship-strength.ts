/**
 * The CRM relationship-strength scale — how strong our relationship with a
 * contact is, from a brand-new introduction to a trusted champion. A pure,
 * client-importable module (no `db`/drizzle) so the `contacts.relationshipStrength`
 * column, the zod schemas, and the star-rating UI share one source of truth
 * (mirrors `@/lib/performance/feedback-rating`). Stored as a 1–5 integer; null = not yet rated.
 */

export const RELATIONSHIP_STRENGTH_MIN = 1;
export const RELATIONSHIP_STRENGTH_MAX = 5;

const RELATIONSHIP_STRENGTH_LEVELS = [1, 2, 3, 4, 5] as const;

export type RelationshipStrength =
  (typeof RELATIONSHIP_STRENGTH_LEVELS)[number];

/** Short label for each level, shown beneath the stars. */
const RELATIONSHIP_STRENGTH_LABELS: Record<RelationshipStrength, string> = {
  1: "New / Unestablished",
  2: "Weak",
  3: "Developing",
  4: "Strong Supporter",
  5: "Champion / Trusted Partner",
};

/** The label for a stored value, or a fallback when unrated/out of range. */
export function relationshipStrengthLabel(value: number | null): string {
  if (value === null) return "Not yet rated";
  return RELATIONSHIP_STRENGTH_LABELS[value as RelationshipStrength] ?? "—";
}
