/**
 * "What am I on right now" — the home dashboard's active-projects derivation.
 * A pure, client-importable module (no `db`/drizzle, no React) over the roles and
 * delivery-manager seats `getMyAllocations` returns.
 *
 * "Currently active" is the same predicate the allocations planner and the
 * timesheet prefill use: a live-status role whose span contains today. Two roles
 * on the same project merge into one entry summing their hours, because a person
 * holding Engineer + Architect on one engagement is on *one* project.
 *
 * A delivery-manager seat counts too — omitting it would make the widget wrong for
 * exactly the people who run delivery. But `project_delivery_managers` carries no
 * dates, so the project counts as active when today falls inside its live-role
 * span, and its load is explicitly `null`: inventing a percentage would corrupt
 * the total sitting next to it.
 */

import type {
  MyAllocationRole,
  MyManagedProject,
} from "@/actions/allocations/getMyAllocations";

/** A full working day — the 100% baseline, matching the allocations planner. */
const HOURS_PER_DAY = 8;

/** One project the person is on today. */
export type ActiveProject = {
  projectId: string;
  projectName: string;
  companyName: string;
  /** Combined nominal load across their roles on it; null for a DM-only seat. */
  loadPercent: number | null;
  /** Every role they hold on it is tentative — nothing is committed yet. */
  tentativeOnly: boolean;
  /** They run the project but hold no role on it. */
  deliveryManagerOnly: boolean;
};

function isLiveToday(
  span: { startDate: string | null; endDate: string | null },
  today: string,
): boolean {
  return (
    span.startDate !== null &&
    span.endDate !== null &&
    span.startDate <= today &&
    span.endDate >= today
  );
}

/**
 * The projects the person is on today, heaviest commitment first, then by name.
 * Delivery-manager-only projects sort last — they carry no load to rank by.
 */
export function activeProjects(
  roles: readonly MyAllocationRole[],
  managedProjects: readonly MyManagedProject[],
  today: string,
): ActiveProject[] {
  const byProject = new Map<string, ActiveProject>();

  for (const role of roles) {
    if (!isLiveToday(role, today)) continue;
    const existing = byProject.get(role.projectId);
    const load = Math.round((role.hoursPerDay / HOURS_PER_DAY) * 100);
    if (existing) {
      existing.loadPercent = (existing.loadPercent ?? 0) + load;
      existing.tentativeOnly =
        existing.tentativeOnly && role.status === "tentative";
      continue;
    }
    byProject.set(role.projectId, {
      projectId: role.projectId,
      projectName: role.projectName,
      companyName: role.companyName,
      loadPercent: load,
      tentativeOnly: role.status === "tentative",
      deliveryManagerOnly: false,
    });
  }

  for (const project of managedProjects) {
    if (byProject.has(project.projectId)) continue;
    if (
      !isLiveToday(
        { startDate: project.liveStart, endDate: project.liveEnd },
        today,
      )
    )
      continue;
    byProject.set(project.projectId, {
      projectId: project.projectId,
      projectName: project.projectName,
      companyName: project.companyName,
      loadPercent: null,
      tentativeOnly: false,
      deliveryManagerOnly: true,
    });
  }

  return [...byProject.values()].sort((a, b) => {
    if (a.loadPercent === null || b.loadPercent === null) {
      if (a.loadPercent !== b.loadPercent)
        return a.loadPercent === null ? 1 : -1;
    } else if (a.loadPercent !== b.loadPercent) {
      return b.loadPercent - a.loadPercent;
    }
    return a.projectName.localeCompare(b.projectName);
  });
}

/**
 * The person's total committed load today, as a percentage of a full day. Summed
 * across *confirmed* roles only and deliberately **not** capped at 100 — a figure
 * above 100% is the single most useful thing this widget can tell someone, and
 * clamping it would hide the over-allocation. Delivery-manager seats contribute
 * nothing, having no hours.
 */
export function currentLoadPercent(
  roles: readonly MyAllocationRole[],
  today: string,
): number {
  return roles
    .filter((role) => role.status === "confirmed" && isLiveToday(role, today))
    .reduce(
      (sum, role) => sum + Math.round((role.hoursPerDay / HOURS_PER_DAY) * 100),
      0,
    );
}

/**
 * The soonest date the person starts something, when they have nothing today.
 * Null when they're already on a project, or when nothing is booked at all.
 */
export function nextStartDate(
  roles: readonly MyAllocationRole[],
  today: string,
): string | null {
  let soonest: string | null = null;
  for (const role of roles) {
    if (role.startDate <= today) continue;
    if (soonest === null || role.startDate < soonest) soonest = role.startDate;
  }
  return soonest;
}
