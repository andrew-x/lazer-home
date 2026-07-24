import "server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { firstPerKey } from "@/lib/core/collections";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import { db } from "@/lib/db/db";
import {
  projectRoles,
  projects,
  type StaffEmployment,
  staff,
  staffEmployment,
  staffPto,
} from "@/lib/db/schema";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";
import type { StaffSkill } from "@/lib/staff/skills";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import type { PtoType } from "@/lib/staff/staff-enums";
import { STAFF_FILTER_OPTIONS } from "@/lib/staff/staff-filters";

/**
 * Filter dimensions for the allocations planner — the same three staff
 * dimensions the directory offers (line of business, role, employment type).
 * Re-exported here so the page passes them as props without importing the
 * Drizzle schema itself (the actions layer owns all `@/lib/db` access).
 */
export const allocationsFilterOptions = STAFF_FILTER_OPTIONS;

/** One active staff member: identity, latest employment facts, and skills. */
export type AllocationStaffRow = {
  id: string;
  name: string;
  lineOfBusiness: StaffEmployment["lineOfBusiness"] | null;
  role: StaffEmployment["role"] | null;
  employmentType: StaffEmployment["employmentType"] | null;
  skills: StaffSkill[];
  /**
   * Manager/admin-only staffing note. Null for viewers without `staff.edit`
   * (never sent to unprivileged clients) — see {@link getAllocationsGrid}.
   */
  allocationNotes: string | null;
};

/** One staffed project-role span (a person allocated to a project over a range). */
export type AllocationRoleRow = {
  id: string;
  staffId: string;
  projectId: string;
  projectName: string;
  roleType: ProjectRoleType;
  status: ProjectRoleStatus;
  lineOfBusiness: LineOfBusiness;
  description: string | null;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
};

/**
 * One approved time-off span. `type` (the leave reason) is populated only for
 * viewers who hold `pto:[review]`; it is `null` for everyone else — see the
 * disclosure note in {@link getAllocationsGrid}.
 */
export type AllocationTimeOff = {
  staffId: string;
  startDate: string;
  endDate: string;
  type: PtoType | null;
};

export type AllocationsGridData = {
  staff: AllocationStaffRow[];
  roles: AllocationRoleRow[];
  timeOff: AllocationTimeOff[];
  /** Whether the viewer may see and edit the allocation-notes column. */
  canEditNotes: boolean;
};

/**
 * The raw material for the allocations planner: every active staff member, the
 * staffed (tentative/confirmed) project-role spans, and approved time off. Week
 * bucketing and percentages are pure client math (`@/lib/allocations/allocations-grid`),
 * so this read stays a simple projection.
 *
 * No metadata gate: the `(app)` layout guarantees the viewer is signed in, and
 * project-role reads are open by design — this page is visible to everyone.
 */
export async function getAllocationsGrid(): Promise<AllocationsGridData> {
  const staffRows = await db
    .select({
      id: staff.id,
      name: staff.name,
      skills: staff.skills,
      allocationNotes: staff.allocationNotes,
    })
    .from(staff)
    .where(eq(staff.isActive, true))
    .orderBy(asc(staff.name));

  // Latest employment fact per person (effective-dating tiebreak, ADR 0007) —
  // two queries, no N+1, mirroring `getStaffDirectory`.
  const employmentRows = await db
    .select({
      staffId: staffEmployment.staffId,
      lineOfBusiness: staffEmployment.lineOfBusiness,
      role: staffEmployment.role,
      employmentType: staffEmployment.employmentType,
    })
    .from(staffEmployment)
    .orderBy(...latestEmploymentFirst);
  const latestByStaff = firstPerKey(employmentRows, (row) => row.staffId);

  // Staffed roles only (a placeholder/open position has no person to row), and
  // only the two live planning states — a paused/cancelled role isn't an active
  // allocation.
  const roleRows = await db
    .select({
      id: projectRoles.id,
      staffId: projectRoles.staffId,
      projectId: projectRoles.projectId,
      projectName: projects.name,
      roleType: projectRoles.roleType,
      status: projectRoles.status,
      lineOfBusiness: projectRoles.lineOfBusiness,
      description: projectRoles.description,
      startDate: projectRoles.startDate,
      endDate: projectRoles.endDate,
      hoursPerDay: projectRoles.hoursPerDay,
    })
    .from(projectRoles)
    .innerJoin(projects, eq(projectRoles.projectId, projects.id))
    .where(
      and(
        isNotNull(projectRoles.staffId),
        inArray(projectRoles.status, ["tentative", "confirmed"]),
      ),
    );

  // PTO disclosure: viewing another person's leave *reason* is a manager/admin
  // capability (`pto:[review]`). This page is public, so we surface only
  // availability ("Away") to every viewer and reveal the leave type solely to
  // those who hold `pto:[review]`. A deliberate, minimal disclosure — NOT a
  // loosening of the PTO gate. Only approved (non-pending) leave is shown.
  const currentUser = await getCurrentUser();
  const canSeePtoType = currentUser
    ? userHasPermission(currentUser, { pto: ["review"] })
    : false;
  // Allocation notes are manager/admin-only staffing metadata. Gate both the
  // read here (never ship the value to an unprivileged client) and the write
  // (`updateStaffAllocationNotes`) on `staff.edit`.
  const canEditNotes = currentUser
    ? userHasPermission(currentUser, { staff: ["edit"] })
    : false;

  const ptoRows = await db
    .select({
      staffId: staffPto.staffId,
      startDate: staffPto.startDate,
      endDate: staffPto.endDate,
      type: staffPto.type,
    })
    .from(staffPto)
    .where(eq(staffPto.isPending, false));

  const staffList: AllocationStaffRow[] = staffRows.map((s) => {
    const employment = latestByStaff.get(s.id);
    return {
      id: s.id,
      name: s.name,
      skills: s.skills,
      lineOfBusiness: employment?.lineOfBusiness ?? null,
      role: employment?.role ?? null,
      employmentType: employment?.employmentType ?? null,
      allocationNotes: canEditNotes ? s.allocationNotes : null,
    };
  });

  const roles: AllocationRoleRow[] = roleRows
    .filter((r): r is typeof r & { staffId: string } => r.staffId !== null)
    .map((r) => ({
      id: r.id,
      staffId: r.staffId,
      projectId: r.projectId,
      projectName: r.projectName,
      roleType: r.roleType,
      status: r.status,
      lineOfBusiness: r.lineOfBusiness,
      description: r.description,
      startDate: r.startDate,
      endDate: r.endDate,
      hoursPerDay: r.hoursPerDay,
    }));

  const timeOff: AllocationTimeOff[] = ptoRows.map((p) => ({
    staffId: p.staffId,
    startDate: p.startDate,
    endDate: p.endDate,
    type: canSeePtoType ? p.type : null,
  }));

  return { staff: staffList, roles, timeOff, canEditNotes };
}
