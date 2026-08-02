import "server-only";

import { and, asc, eq, gte, inArray, lte, max, min } from "drizzle-orm";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { db } from "@/lib/db/db";
import {
  companies,
  projectDeliveryManagers,
  projectRoles,
  projects,
} from "@/lib/db/schema";
import type { TimelineRoleInput } from "@/lib/home/allocation-timeline";
import { timelineWindow } from "@/lib/home/allocation-timeline";
import { currentDay } from "@/lib/timesheets/timesheet-week";

/**
 * One of the signed-in person's project roles. Structurally a
 * {@link TimelineRoleInput} so the timeline's pure layout math takes it directly,
 * plus the client name the home card shows next to the project.
 */
export type MyAllocationRole = TimelineRoleInput & {
  companyName: string;
};

/**
 * A project the person runs as delivery manager. `project_delivery_managers`
 * carries no dates of its own, so the window is derived from the project's live
 * roles (whoever holds them) — that's what makes "am I currently on this?"
 * answerable for a DM seat.
 */
export type MyManagedProject = {
  projectId: string;
  projectName: string;
  companyName: string;
  /** Earliest start across the project's live roles; null if it has none. */
  liveStart: string | null;
  /** Latest end across the project's live roles; null if it has none. */
  liveEnd: string | null;
};

export type MyAllocationsView = {
  /** Null when the signed-in user has no linked staff record. */
  staffId: string | null;
  roles: MyAllocationRole[];
  managedProjects: MyManagedProject[];
};

/** The two live planning states — a paused/cancelled role isn't an allocation. */
const LIVE_STATUSES = ["tentative", "confirmed"] as const;

/**
 * The signed-in person's own allocations, for the home dashboard's "active
 * projects" tile and allocation timeline.
 *
 * **Takes no `staffId`.** It is own-data-only by construction, so there is no
 * cross-user id to authorize and no gate to get wrong; the `(app)` layout has
 * already established that the viewer is signed in with an active staff record.
 * An unlinked account gets empty lists rather than an error.
 *
 * Roles are bounded to the timeline's display window (`@/lib/home/allocation-timeline`)
 * so the SQL and the rendering can't disagree about what "recent" means.
 */
export async function getMyAllocations(): Promise<MyAllocationsView> {
  const staffId = await getCurrentStaffId();
  if (!staffId) return { staffId: null, roles: [], managedProjects: [] };

  const window = timelineWindow(currentDay());

  const [roleRows, managedRows] = await Promise.all([
    db
      .select({
        roleId: projectRoles.id,
        projectId: projectRoles.projectId,
        projectName: projects.name,
        companyName: companies.name,
        roleType: projectRoles.roleType,
        status: projectRoles.status,
        description: projectRoles.description,
        startDate: projectRoles.startDate,
        endDate: projectRoles.endDate,
        hoursPerDay: projectRoles.hoursPerDay,
      })
      .from(projectRoles)
      .innerJoin(projects, eq(projectRoles.projectId, projects.id))
      .innerJoin(companies, eq(projects.companyId, companies.id))
      .where(
        and(
          eq(projectRoles.staffId, staffId),
          inArray(projectRoles.status, [...LIVE_STATUSES]),
          // Overlaps the window: starts before it ends, ends after it starts.
          lte(projectRoles.startDate, window.end),
          gte(projectRoles.endDate, window.start),
        ),
      )
      .orderBy(asc(projectRoles.startDate)),

    // Delivery-manager seats, with each project's live-role span folded in so the
    // caller can tell whether the project is running right now.
    db
      .select({
        projectId: projects.id,
        projectName: projects.name,
        companyName: companies.name,
        liveStart: min(projectRoles.startDate),
        liveEnd: max(projectRoles.endDate),
      })
      .from(projectDeliveryManagers)
      .innerJoin(projects, eq(projectDeliveryManagers.projectId, projects.id))
      .innerJoin(companies, eq(projects.companyId, companies.id))
      .leftJoin(
        projectRoles,
        and(
          eq(projectRoles.projectId, projects.id),
          inArray(projectRoles.status, [...LIVE_STATUSES]),
        ),
      )
      .where(eq(projectDeliveryManagers.staffId, staffId))
      .groupBy(projects.id, projects.name, companies.name)
      .orderBy(asc(projects.name)),
  ]);

  return {
    staffId,
    roles: roleRows,
    managedProjects: managedRows.map((row) => ({
      ...row,
      liveStart: row.liveStart ?? null,
      liveEnd: row.liveEnd ?? null,
    })),
  };
}
