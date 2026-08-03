import "server-only";

import { and, asc, eq, gte, inArray, max, min } from "drizzle-orm";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { db } from "@/lib/db/db";
import {
  companies,
  projectDeliveryManagers,
  projectRoles,
  projects,
} from "@/lib/db/schema";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";
import { currentDay } from "@/lib/timesheets/timesheet-week";

/**
 * One of the signed-in person's project roles, with the client name the home
 * table shows next to the project.
 */
export type MyAllocationRole = {
  roleId: string;
  projectId: string;
  projectName: string;
  companyName: string;
  roleType: ProjectRoleType;
  status: ProjectRoleStatus;
  description: string | null;
  startDate: string;
  endDate: string;
  /** Nominal hours a day; percent of a full day is `hoursPerDay / 8`. */
  hoursPerDay: number;
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
 * The signed-in person's own allocations, for the home dashboard's "Your Status"
 * table — what they're on, from when to when, at how many hours a day.
 *
 * **Takes no `staffId`.** It is own-data-only by construction, so there is no
 * cross-user id to authorize and no gate to get wrong; the `(app)` layout has
 * already established that the viewer is signed in with an active staff record.
 * An unlinked account gets empty lists rather than an error.
 *
 * Roles are **live or upcoming** — anything whose `endDate` is today or later, with
 * no forward bound. An earlier version clipped them to a gantt's −1/+2-month display
 * window; that gantt is gone, and clipping would have hidden a role starting next
 * quarter from a table whose whole job is showing what's next.
 */
export async function getMyAllocations(): Promise<MyAllocationsView> {
  const staffId = await getCurrentStaffId();
  if (!staffId) return { staffId: null, roles: [], managedProjects: [] };

  const today = currentDay();

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
          // Live or upcoming, with no upper bound: the home table answers "what am
          // I on, and what's next", so a role starting six months out belongs in it.
          // Roles that have already ended are the only ones excluded.
          gte(projectRoles.endDate, today),
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
