/**
 * "What am I on" — the home dashboard's own-allocations derivation, over the roles
 * and delivery-manager seats `getMyAllocations` returns. A pure,
 * client-importable module (no `db`/drizzle, no React).
 *
 * Two **concurrent** roles on the same project merge into one row summing their
 * hours: a person holding Engineer + Architect on one engagement is on *one*
 * project, and two rows would read as two commitments. Roles that don't overlap
 * today are never merged with ones that do — see {@link buildMyAllocationRows}.
 *
 * A delivery-manager seat counts too — omitting it would make the widget wrong for
 * exactly the people who run delivery. But `project_delivery_managers` carries no
 * dates and no hours, so such a row's `hoursPerDay` is explicitly `null`:
 * inventing a number would corrupt a column people read down.
 */

import type {
  MyAllocationRole,
  MyManagedProject,
} from "@/actions/allocations/getMyAllocations";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";

/** A full working day — the 100% baseline, matching the allocations planner. */
const HOURS_PER_DAY = 8;

/** One project the person is committed to, as the Your Status table renders it. */
export type MyAllocationRow = {
  /**
   * Stable react key. Carries the bucket as well as the project id, because one
   * project can legitimately produce both a live row and an upcoming one.
   */
  key: string;
  projectId: string;
  projectName: string;
  companyName: string;
  /** Every role type they hold on it, for the sub-line. Empty for a DM-only seat. */
  roleTypes: ProjectRoleType[];
  /** Combined nominal hours a day; null for a delivery-manager-only seat. */
  hoursPerDay: number | null;
  /** Earliest start across their roles on it; null for a DM-only seat. */
  startDate: string | null;
  /** Latest end across their roles on it; null for a DM-only seat. */
  endDate: string | null;
  /**
   * `tentative` only when *every* role they hold on the project is tentative —
   * one confirmed role means the commitment is real.
   */
  status: ProjectRoleStatus;
  /** They run the project but hold no role on it. */
  deliveryManagerOnly: boolean;
};

function isLiveOn(
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
 * Fold a set of roles into one row per project, summing hours and widening the
 * span. `bucket` only distinguishes the react keys, since one project can legally
 * produce a row in *both* buckets.
 */
function foldByProject(
  roles: readonly MyAllocationRole[],
  bucket: "live" | "upcoming",
): Map<string, MyAllocationRow> {
  const byProject = new Map<string, MyAllocationRow>();

  for (const role of roles) {
    const existing = byProject.get(role.projectId);
    if (existing) {
      existing.hoursPerDay = (existing.hoursPerDay ?? 0) + role.hoursPerDay;
      existing.roleTypes = existing.roleTypes.includes(role.roleType)
        ? existing.roleTypes
        : [...existing.roleTypes, role.roleType];
      existing.startDate =
        existing.startDate && existing.startDate < role.startDate
          ? existing.startDate
          : role.startDate;
      existing.endDate =
        existing.endDate && existing.endDate > role.endDate
          ? existing.endDate
          : role.endDate;
      // One confirmed role is enough to make the whole commitment real.
      if (role.status === "confirmed") existing.status = "confirmed";
      continue;
    }
    byProject.set(role.projectId, {
      key: `${bucket}-${role.projectId}`,
      projectId: role.projectId,
      projectName: role.projectName,
      companyName: role.companyName,
      roleTypes: [role.roleType],
      hoursPerDay: role.hoursPerDay,
      startDate: role.startDate,
      endDate: role.endDate,
      status: role.status,
      deliveryManagerOnly: false,
    });
  }

  return byProject;
}

/**
 * Fold the person's roles into one row per project, split into what is running
 * today and what is still ahead.
 *
 * **Each role is bucketed before anything is merged**, and merging only ever
 * happens *within* a bucket. Merging first and bucketing the result would sum a
 * live role with a future one on the same project and report the total as today's
 * commitment: someone at 4h/day now, stepping up to 8h in November, would read as
 * 8h/day today, and the November step-up would vanish into the merged row's end
 * date. Because of this, one project can correctly appear in both lists — at its
 * current load in `live`, and again in `upcoming` for the part that hasn't started.
 * Row keys carry the bucket so the two never collide.
 *
 * `live` sorts by heaviest commitment first, then by name; `upcoming` sorts by
 * start date, since "what's next" is a question about order. Delivery-manager-only
 * seats sort last within `live` — they carry no load to rank by.
 *
 * Roles that have already ended never arrive here: `getMyAllocations` bounds its
 * query to `endDate >= today`. They're filtered again anyway, so this stays correct
 * if that read is ever widened.
 */
export function buildMyAllocationRows(
  roles: readonly MyAllocationRole[],
  managedProjects: readonly MyManagedProject[],
  today: string,
): { live: MyAllocationRow[]; upcoming: MyAllocationRow[] } {
  const liveRoles = roles.filter((role) => isLiveOn(role, today));
  const upcomingRoles = roles.filter((role) => role.startDate > today);

  const byProject = foldByProject(liveRoles, "live");
  const upcomingByProject = foldByProject(upcomingRoles, "upcoming");

  for (const project of managedProjects) {
    if (byProject.has(project.projectId)) continue;
    // A DM seat is only worth showing while the project it runs is live — the seat
    // itself has no dates, so an ended project would otherwise linger forever.
    if (
      !isLiveOn(
        { startDate: project.liveStart, endDate: project.liveEnd },
        today,
      )
    )
      continue;
    byProject.set(project.projectId, {
      key: `live-${project.projectId}`,
      projectId: project.projectId,
      projectName: project.projectName,
      companyName: project.companyName,
      roleTypes: [],
      hoursPerDay: null,
      startDate: project.liveStart,
      endDate: project.liveEnd,
      status: "confirmed",
      deliveryManagerOnly: true,
    });
  }

  const live = [...byProject.values()].sort((a, b) => {
    if (a.hoursPerDay === null || b.hoursPerDay === null) {
      if (a.hoursPerDay !== b.hoursPerDay)
        return a.hoursPerDay === null ? 1 : -1;
    } else if (a.hoursPerDay !== b.hoursPerDay) {
      return b.hoursPerDay - a.hoursPerDay;
    }
    return a.projectName.localeCompare(b.projectName);
  });

  const upcoming = [...upcomingByProject.values()].sort(
    (a, b) =>
      (a.startDate ?? "").localeCompare(b.startDate ?? "") ||
      a.projectName.localeCompare(b.projectName),
  );

  return { live, upcoming };
}

/**
 * The person's total committed load today, as a percentage of a full day. Summed
 * across *confirmed* roles only and deliberately **not** capped at 100 — a figure
 * above 100% is the single most useful thing this can tell someone, and clamping it
 * would hide the over-allocation. Delivery-manager seats contribute nothing, having
 * no hours.
 */
export function currentLoadPercent(
  roles: readonly MyAllocationRole[],
  today: string,
): number {
  return roles
    .filter(
      (role) =>
        role.status === "confirmed" &&
        role.startDate <= today &&
        role.endDate >= today,
    )
    .reduce(
      (sum, role) => sum + Math.round((role.hoursPerDay / HOURS_PER_DAY) * 100),
      0,
    );
}
