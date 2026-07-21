/**
 * Derived project fields. A project no longer stores a status or a line of
 * business of its own — both are computed from its roles. Declared as a pure,
 * client-importable module (no `db`/drizzle) so reads (`getProjectsPage`,
 * `getOpportunityPlan`), UI, and tests all share one implementation.
 *
 * See docs/domains/projects.md and the 2026-07-19 design.
 */
import { LINE_OF_BUSINESS, type LineOfBusiness } from "@/lib/line-of-business";
import type { ProjectRoleStatus } from "@/lib/project-role-status";

/**
 * A project's derived lifecycle status, computed from its roles' statuses:
 *
 * - no roles → `tentative` (nothing planned yet)
 * - every role `cancelled` → `cancelled`
 * - otherwise, over the non-cancelled roles: any `tentative` → `tentative`;
 *   else any `paused` → `paused`; else (all confirmed) → `confirmed`.
 *
 * The precedence "least-committed wins" (tentative > paused > confirmed) means a
 * project only reads as confirmed once all its live roles are confirmed — which
 * is exactly what `confirmRolesOnWon` produces when an opportunity is won.
 *
 * LOCKSTEP: the "confirmed" case is re-expressed in SQL by `isClientExpr` in
 * `src/actions/crm/getCompaniesPage.ts` (∃ confirmed role ∧ ∄ tentative/paused
 * role) to tag client companies. Keep the two in sync; the agreement test in
 * `project-derived.test.ts` guards it.
 */
export function deriveProjectStatus(
  roleStatuses: readonly ProjectRoleStatus[],
): ProjectRoleStatus {
  if (roleStatuses.length === 0) return "tentative";

  const live = roleStatuses.filter((s) => s !== "cancelled");
  if (live.length === 0) return "cancelled";

  if (live.some((s) => s === "tentative")) return "tentative";
  if (live.some((s) => s === "paused")) return "paused";
  return "confirmed";
}

/**
 * A project's derived set of lines of business: the distinct LoBs across its
 * roles, returned in canonical `LINE_OF_BUSINESS` order (stable, dedup'd). An
 * empty project yields an empty array.
 */
export function deriveProjectLinesOfBusiness(
  roleLinesOfBusiness: readonly LineOfBusiness[],
): LineOfBusiness[] {
  const present = new Set(roleLinesOfBusiness);
  return LINE_OF_BUSINESS.filter((lob) => present.has(lob));
}
