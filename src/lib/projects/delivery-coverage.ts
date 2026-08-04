/**
 * Who runs a project, and when nobody does. A pure, client-importable module (no
 * `db`/drizzle, no React) so the plan reads, the projects-list read, the detail
 * sidebar and the coverage warning all share exactly one definition of "delivery
 * manager" — the same shape as `@/lib/projects/project-derived` and
 * `@/lib/projects/project-flags`.
 *
 * ── A delivery manager is a role, not a field ───────────────────────────────
 * There used to be a `project_delivery_managers` junction: a dateless, moneyless
 * set of staff per project. It could say who ran an engagement but never who ran
 * it *in March*, so a project could lose delivery coverage mid-flight and nothing
 * noticed. A delivery manager is now an ordinary `project_roles` row with
 * `roleType = "DELIVERY"` — dated, statused and priced like every other line — and
 * a project's delivery managers are *derived* from those roles, exactly as its
 * status, lines of business and health already are (ADR 0069).
 *
 * What that unlocks is the thing the junction structurally could not have: a
 * **coverage gap**. {@link deliveryCoverageGaps} is the only place that is defined.
 *
 * ── Why the policy lives in code ────────────────────────────────────────────
 * "Covered" is a judgement, not per-project data — every project must be judged by
 * the same one, or two surfaces could silently disagree about whether an
 * engagement is being run. Same reasoning as `@/lib/projects/project-flags` and
 * `@/lib/projects/bill-rates` (ADR 0042). The judgements are the three predicates
 * below, and each is asserted by name in `delivery-coverage.test.ts` so flipping
 * one is a deliberate, visible change.
 */

import type { DateSpan } from "@/lib/allocations/weekdays";
import { rangeOf } from "@/lib/projects/plan-summary";
import {
  type ProjectRoleStatus,
  ROLE_STATUS,
} from "@/lib/projects/project-role-status";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";
import { addDays, isWeekend } from "@/lib/timesheets/timesheet-week";

/**
 * When the coverage policy below was last revised. Bump it when you change one of
 * the predicates, so a warning can be read with the right amount of confidence.
 * There is deliberately no threshold *number* here — see
 * {@link deliveryCoverageGaps}.
 */
export const DELIVERY_COVERAGE_REVIEWED_ON = "2026-08-04";

/**
 * The fields a coverage decision needs from a role. Structurally satisfied as-is
 * by `PlanRole` (both plan reads) and by `getProjectsList`'s role rows, so no
 * caller reshapes anything.
 */
export type DeliveryCoverageRole = {
  roleType: ProjectRoleType;
  status: ProjectRoleStatus;
  staffId: string | null;
  staffName: string | null;
  /** Inclusive "YYYY-MM-DD". */
  startDate: string;
  /** Inclusive "YYYY-MM-DD". */
  endDate: string;
};

/** A delivery role with a named person on it — see {@link isDeliveryCoverage}. */
type NamedDeliveryRole = DeliveryCoverageRole & {
  staffId: string;
  staffName: string;
};

/**
 * A stretch of the project with no delivery manager on it. Bounds are inclusive
 * weekdays — a gap can never start or end on a weekend, so `formatDateRange` over
 * one always names working days.
 */
export type DeliveryCoverageGap = DateSpan & {
  /** Mon–Fri days in the gap. Weekends are not counted (nor spanned). */
  weekdays: number;
};

/** A person who runs the project, and the spans over which they do. */
export type DeliveryManagerSummary = {
  id: string;
  name: string;
  /** Their delivery roles' spans, chronological. Usually one. */
  spans: DateSpan[];
};

/**
 * Is this role a live commitment? Only `cancelled` is excluded: `paused` work is
 * expected to resume on the dates it still carries, and `tentative` work is what a
 * plan mostly *is* before an opportunity closes.
 *
 * This agrees with `countsTowardBudget` today and is deliberately *not* it: that
 * answers "does this line's money belong in the budget", where this answers "is
 * this line part of the plan". Sharing one function would silently move coverage
 * the day a commercial rule changed — the same reason `project-margin.ts` declines
 * to reuse the allocations grid's status filter.
 */
function isLiveRole(status: ProjectRoleStatus): boolean {
  return status !== ROLE_STATUS.cancelled;
}

/**
 * Is this a live delivery role, staffed or not? Distinguishing this from
 * {@link isDeliveryCoverage} is what lets the sidebar say "there is a delivery role
 * but nobody is in it" rather than the flatly wrong "unassigned".
 */
export function isDeliveryRole(role: DeliveryCoverageRole): boolean {
  return role.roleType === "DELIVERY" && isLiveRole(role.status);
}

/**
 * Does this role count as delivery coverage? A live `DELIVERY` role **with a named
 * person on it**.
 *
 * An OPEN (unstaffed) delivery role does not cover: "no period without a delivery
 * manager" read literally, a seat nobody sits in contains no manager, and the
 * warning going quiet at exactly the moment nobody is accountable would be the
 * wrong failure mode.
 *
 * The `staffName` half is implied by `staffId` — the FK guarantees the join
 * matches — and is asserted only so the derived list below needs no fallback for a
 * name that cannot actually be missing.
 */
export function isDeliveryCoverage(
  role: DeliveryCoverageRole,
): role is NamedDeliveryRole {
  return (
    isDeliveryRole(role) && role.staffId !== null && role.staffName !== null
  );
}

/**
 * Does this role create something that needs managing? Any live *non*-delivery
 * line.
 *
 * Excluding delivery roles from the window matters twice: a delivery manager
 * wrapping up a month past the last engineer must not widen the window it then
 * trivially covers, and a project consisting only of delivery roles has nothing to
 * manage, so it reports no gaps rather than a self-covering tautology.
 */
export function needsDeliveryCoverage(role: DeliveryCoverageRole): boolean {
  return role.roleType !== "DELIVERY" && isLiveRole(role.status);
}

/**
 * The working periods of the project that no delivery manager covers, as maximal
 * chronological runs. Empty when the plan is covered — or when there is nothing to
 * cover (no live non-delivery roles, so no window).
 *
 * The window is min-start … max-end across the roles that need covering, the same
 * derivation every other project-window figure uses ({@link rangeOf}); a project
 * has no stored dates of its own.
 *
 * ── Weekends are never gap days ─────────────────────────────────────────────
 * This is the bug a reader will look for, so: the `isWeekend` skip means a Saturday
 * is neither added to a run *nor allowed to end one*. A delivery role ending Friday
 * the 6th and its successor starting Monday the 9th therefore yields no gap — the
 * loop never visits an uncovered day between them. Without the skip, near every
 * clean handover would warn.
 *
 * ── No minimum-gap threshold ────────────────────────────────────────────────
 * A single uncovered weekday is reported. The cost is that a role typed one day
 * short of its successor warns; the benefit is that the rule needs no explaining
 * and no number to keep reviewed. If that proves noisy, the fix is one
 * `.filter((gap) => gap.weekdays >= MIN_…)` on the way out of this function, which
 * is why {@link DeliveryCoverageGap.weekdays} is carried even though nothing reads
 * it yet.
 *
 * Cost is O(window days × delivery roles) — a few thousand string comparisons per
 * project, and `getProjectsList` already counts working days per role per project
 * twice over for margin. A merge-intervals sweep would be asymptotically better but
 * would still have to count weekdays inside each hole to tell a real gap from a
 * weekend seam, i.e. the same iteration with more code.
 */
export function deliveryCoverageGaps(
  roles: readonly DeliveryCoverageRole[],
): DeliveryCoverageGap[] {
  const window = rangeOf(roles.filter(needsDeliveryCoverage));
  if (!window) return [];
  const covering = roles.filter(isDeliveryCoverage);

  const gaps: DeliveryCoverageGap[] = [];
  let run: DeliveryCoverageGap | null = null;

  // "YYYY-MM-DD" is zero-padded, so lexicographic order === chronological.
  for (let day = window.start; day <= window.end; day = addDays(day, 1)) {
    if (isWeekend(day)) continue;
    const covered = covering.some(
      (role) => day >= role.startDate && day <= role.endDate,
    );
    if (covered) {
      if (run) gaps.push(run);
      run = null;
      continue;
    }
    run = run
      ? { startDate: run.startDate, endDate: day, weekdays: run.weekdays + 1 }
      : { startDate: day, endDate: day, weekdays: 1 };
  }
  if (run) gaps.push(run);

  return gaps;
}

/**
 * The project's delivery managers — distinct people on its live delivery roles,
 * name-ordered, each carrying the spans they run.
 *
 * The single definition behind the detail sidebar, the projects-list Delivery
 * column and the `dm` filter, so the three can't disagree about who runs what. It
 * is deliberately **all-time** rather than "who runs it today": the filter is
 * inherently all-time (a `dm=` link should still find the engagement you ran last
 * year), it mirrors the derived line-of-business field it sits beside, and a
 * current-only list would read as missing data on every finished project. The dated
 * reality is carried by `spans` and by the Roles tab.
 */
export function deliveryManagersOf(
  roles: readonly DeliveryCoverageRole[],
): DeliveryManagerSummary[] {
  const byId = new Map<string, DeliveryManagerSummary>();
  for (const role of roles) {
    if (!isDeliveryCoverage(role)) continue;
    const entry = byId.get(role.staffId);
    const span = { startDate: role.startDate, endDate: role.endDate };
    if (entry) {
      entry.spans.push(span);
      continue;
    }
    byId.set(role.staffId, {
      id: role.staffId,
      name: role.staffName,
      spans: [span],
    });
  }
  for (const entry of byId.values()) {
    entry.spans.sort((a, b) => a.startDate.localeCompare(b.startDate));
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
