/**
 * The project-health scale — the delivery manager's own read on how an engagement
 * is actually going, from "escalate today" to "hold this up as an example". A
 * pure, client-importable module (no `db`/drizzle) so the
 * `project_delivery_notes.projectHealth` column, its zod schema, the star-rating
 * input, the projects-list card and the low-health flag all share one source of
 * truth (mirrors `@/lib/crm/relationship-strength` and
 * `@/lib/performance/feedback-rating`; ADR 0016). Stored as a 1–10 integer.
 *
 * TEN points, not the five of `relationshipStrength`: this is a judgement people
 * already voice as "a seven", and a five-point scale collapses the whole
 * interesting middle — "fine but keep an eye on it" and "actually wobbling" would
 * land on the same star. The cost is that no two adjacent labels differ much;
 * that is inherent to a 10-point scale, and the labels read as a band rather than
 * a verdict.
 *
 * What counts as *low* health deliberately lives elsewhere — see
 * `LOW_PROJECT_HEALTH_AT_OR_BELOW` in `@/lib/projects/project-flags`. This module
 * answers "what does a 4 mean" (vocabulary); that one answers "what counts as
 * trouble" (policy), and they are revised on different cadences.
 */

export const PROJECT_HEALTH_MIN = 1;
export const PROJECT_HEALTH_MAX = 10;

const PROJECT_HEALTH_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export type ProjectHealth = (typeof PROJECT_HEALTH_LEVELS)[number];

/** Short label for each level, shown beneath the stars and beside the number. */
const PROJECT_HEALTH_LABELS: Record<ProjectHealth, string> = {
  1: "Critical",
  2: "Failing",
  3: "At risk",
  4: "Struggling",
  5: "Mixed",
  6: "Fair",
  7: "Steady",
  8: "Healthy",
  9: "Strong",
  10: "Exemplary",
};

/**
 * What a project with no delivery notes reads as. Deliberately not "Poor" or a
 * bare "—": nobody has assessed it yet, which is a different thing from an
 * assessment that came back badly (and earns no flag — see `project-flags.ts`).
 */
export const PROJECT_HEALTH_UNRATED_LABEL = "Not rated";

/** The label for a stored value, or a fallback when unrated/out of range. */
export function projectHealthLabel(value: number | null): string {
  if (value === null) return PROJECT_HEALTH_UNRATED_LABEL;
  return PROJECT_HEALTH_LABELS[value as ProjectHealth] ?? "—";
}
