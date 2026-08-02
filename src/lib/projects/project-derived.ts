/**
 * Derived project fields. A project no longer stores a status or a line of
 * business of its own — both are computed from its roles. Declared as a pure,
 * client-importable module (no `db`/drizzle) so reads (`getProjectsList`,
 * `getOpportunityPlan`), UI, and tests all share one implementation.
 *
 * See docs/domains/projects.md and the 2026-07-19 design.
 */
import {
  LINE_OF_BUSINESS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";

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

/**
 * The sections the projects list groups by: `tentative`, `paused`, `active`
 * (confirmed & still running), `past` (confirmed & finished) and `cancelled`.
 *
 * Four of the five are a relabelling of the derived status, but the confirmed
 * status splits in two on the calendar: a delivered engagement is still
 * "confirmed", so `active` vs `past` is decided by whether the project's latest
 * role end date has passed. The list page renders one bucket at a time, as tabs.
 */
export type ProjectStatusBucket =
  | "tentative"
  | "paused"
  | "active"
  | "past"
  | "cancelled";

/**
 * Every bucket, in derived-status order (the calendar split last). This is the
 * canonical *set* — the order the list's tabs appear in is a separate, UI-facing
 * concern that leads with the default tab (see `PROJECT_STATUS_TABS`).
 */
export const PROJECT_STATUS_BUCKETS: ProjectStatusBucket[] = [
  "tentative",
  "paused",
  "active",
  "past",
  "cancelled",
];

/** Display labels for the buckets — the list's tab names. */
export const PROJECT_STATUS_BUCKET_LABELS: Record<ProjectStatusBucket, string> =
  {
    tentative: "Tentative",
    paused: "Paused",
    active: "Active",
    past: "Past",
    cancelled: "Cancelled",
  };

/**
 * Has the engagement finished — is its latest role end date before `today`? A
 * project ending *today* still counts as running. `endDate` is the project's
 * latest role end date (null when it has no roles, which reads as tentative
 * anyway); both dates are zero-padded "YYYY-MM-DD", so a lexicographic compare
 * is chronological.
 */
export function projectHasEnded(
  endDate: string | null,
  today: string,
): boolean {
  return endDate !== null && endDate < today;
}

/**
 * Which list section a project belongs to, from its derived `status` and its
 * latest role `endDate` compared against `today` (see `projectHasEnded` — only
 * the confirmed status is date-sensitive).
 */
export function projectStatusBucket(
  status: ProjectRoleStatus,
  endDate: string | null,
  today: string,
): ProjectStatusBucket {
  if (status === "tentative") return "tentative";
  if (status === "paused") return "paused";
  if (status === "cancelled") return "cancelled";
  return projectHasEnded(endDate, today) ? "past" : "active";
}

/**
 * Does a project with these role statuses and this latest role end date belong
 * in `bucket`? This is the pure mirror of the correlated-`EXISTS` SQL in
 * `src/lib/projects/project-status-sql.ts` (`derivedStatusCondition`), which the
 * projects loader uses to paginate each section in the database.
 *
 * LOCKSTEP: the boolean logic here MUST match that SQL exactly, and both MUST
 * agree with `deriveProjectStatus` composed with `projectStatusBucket`. The
 * agreement test in `project-derived.test.ts` enumerates every role-status
 * combination × ended/running to guard all buckets against drift.
 */
export function statusesMatchBucket(
  bucket: ProjectStatusBucket,
  roleStatuses: readonly ProjectRoleStatus[],
  endDate: string | null,
  today: string,
): boolean {
  const has = (status: ProjectRoleStatus) => roleStatuses.includes(status);
  // No roles reads as tentative; any tentative role wins outright.
  const tentative = roleStatuses.length === 0 || has("tentative");
  // Paused === derived "paused": has a paused role and no tentative role (paused
  // outranks confirmed among live roles, but tentative outranks paused).
  const paused = has("paused") && !has("tentative");
  // Confirmed: has a confirmed role, no tentative/paused. Splits into
  // active/past on the end date.
  const confirmed = has("confirmed") && !has("tentative") && !has("paused");
  const ended = projectHasEnded(endDate, today);
  switch (bucket) {
    case "tentative":
      return tentative;
    case "paused":
      return paused;
    case "active":
      return confirmed && !ended;
    case "past":
      return confirmed && ended;
    default:
      return !tentative && !paused && !confirmed; // cancelled
  }
}
