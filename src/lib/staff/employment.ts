/**
 * The employment billability invariants — the single source of truth shared by
 * every place that authors or validates a staff member's billability facts.
 * Declared here as a pure, client-importable module (no `db`/drizzle, no UI) so
 * the bulk-edit form's as-you-type derivation, the bulk-edit action's
 * server-side `.refine` guard, and the CSV import's derive-on-import all enforce
 * ONE definition and can never drift — mirrors `src/lib/line-of-business.ts`.
 * See docs/domains/staff-profiles.md.
 *
 * The invariants:
 *   1. Non-billable ⇒ `utilizationTarget` is 0. Someone who isn't billable can't
 *      carry a utilization target. This is a standing rule: the bulk-edit
 *      action's guard rejects any write that violates it, so a crafted payload
 *      can't slip a non-zero target onto a non-billable row.
 *   2. Turning management ON defaults a person to non-billable. This is a default
 *      applied at the moment management is enabled — they can be flipped back to
 *      billable afterward — so it fires only on that transition, not as a
 *      standing rule (a billable manager is valid).
 */

/** The billability facts the invariants constrain. */
export type EmploymentFacts = {
  isBillable: boolean;
  utilizationTarget: number;
};

/**
 * Invariant #1 as a predicate: do these facts carry a legal utilization target?
 * The bulk-edit action's `.refine` and the import schema call this so the guard
 * lives in exactly one place. Returns `true` when the facts are valid.
 */
export function isEmploymentInvariantSatisfied(
  facts: EmploymentFacts,
): boolean {
  return facts.isBillable || facts.utilizationTarget === 0;
}

/**
 * Correct a set of facts to satisfy the invariants, returning a new object that
 * preserves any extra fields (line of business, role, …) untouched. Pass
 * `justEnabledManagement` when the change being applied turns management on
 * (invariant #2): that forces non-billable, which in turn zeroes the utilization
 * target via invariant #1.
 */
export function normalizeEmploymentFacts<T extends EmploymentFacts>(
  facts: T,
  opts: { justEnabledManagement?: boolean } = {},
): T {
  // Invariant #2: enabling management makes someone non-billable by default.
  const isBillable = opts.justEnabledManagement ? false : facts.isBillable;
  // Invariant #1: non-billable rows carry a 0% utilization target.
  const utilizationTarget = isBillable ? facts.utilizationTarget : 0;
  return { ...facts, isBillable, utilizationTarget };
}
