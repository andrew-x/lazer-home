import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { cache } from "react";
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
  /**
   * Whether the person's current employment is billable at all. The employment
   * *fact* — not `isBillableRole(role)`, which is only the CSV importer's
   * derivation and is overridable in-app. Surfaces that measure or staff
   * capacity (utilization, the bench, availability) exclude non-billable staff,
   * whose `utilizationTarget` is structurally 0.
   */
  isBillable: boolean | null;
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
 * One **open** project-role span — a placeholder position with nobody allocated to
 * it yet. Structurally an {@link AllocationRoleRow} minus the person: `staffId` is
 * null by definition, so the field is dropped rather than typed nullable, which
 * keeps "a role row always has a person" true of {@link AllocationRoleRow}.
 */
export type OpenRoleRow = Omit<AllocationRoleRow, "staffId">;

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
  /** Live role spans with nobody allocated yet — see {@link OpenRoleRow}. */
  openRoles: OpenRoleRow[];
  timeOff: AllocationTimeOff[];
  /** Whether the viewer may see and edit the allocation-notes column. */
  canEditNotes: boolean;
  /** Whether the viewer may allocate staff to open roles (`projects.edit`). */
  canAllocate: boolean;
};

/**
 * The raw material for the allocations planner: every active staff member, the
 * staffed (tentative/confirmed) project-role spans, the equivalent **open**
 * positions, and approved time off. Week bucketing and percentages are pure client
 * math (`@/lib/allocations/allocations-grid`), so this read stays a simple
 * projection.
 *
 * No capability gate: project-role reads are open by design — `/allocations` and
 * the home dashboard are visible to every signed-in user.
 *
 * It does, however, **fail closed without a session.** The `(app)` layout already
 * redirects an anonymous visitor, but a read this wide — every active person's name,
 * discipline and allocation span — shouldn't depend on its caller to establish that.
 * Returning the empty projection keeps the guarantee local to the read.
 *
 * Request-cached: the allocations planner and the home dashboard both read it,
 * and it takes no arguments, so one render should cost one set of queries.
 */
const EMPTY_GRID: AllocationsGridData = {
  staff: [],
  roles: [],
  openRoles: [],
  timeOff: [],
  canEditNotes: false,
  canAllocate: false,
};

export const getAllocationsGrid = cache(
  async (): Promise<AllocationsGridData> => {
    const currentUser = await getCurrentUser();
    if (!currentUser) return EMPTY_GRID;

    const [staffRows, employmentRows, roleRows, ptoRows] = await Promise.all([
      db
        .select({
          id: staff.id,
          name: staff.name,
          skills: staff.skills,
          allocationNotes: staff.allocationNotes,
        })
        .from(staff)
        .where(eq(staff.isActive, true))
        .orderBy(asc(staff.name)),

      // Latest employment fact per person (effective-dating tiebreak, ADR 0007) —
      // a second query rather than an N+1, mirroring `getStaffDirectory`.
      db
        .select({
          staffId: staffEmployment.staffId,
          lineOfBusiness: staffEmployment.lineOfBusiness,
          role: staffEmployment.role,
          employmentType: staffEmployment.employmentType,
          isBillable: staffEmployment.isBillable,
        })
        .from(staffEmployment)
        .orderBy(...latestEmploymentFirst),

      // Both staffed and open (placeholder) roles, in the two live planning states —
      // a paused/cancelled role isn't an active allocation. The staffed/open split
      // happens below on `staffId`, so this is one query feeding two projections
      // rather than a second round trip for the open positions.
      db
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
        .where(inArray(projectRoles.status, ["tentative", "confirmed"])),

      db
        .select({
          staffId: staffPto.staffId,
          startDate: staffPto.startDate,
          endDate: staffPto.endDate,
          type: staffPto.type,
        })
        .from(staffPto)
        .where(eq(staffPto.isPending, false)),
    ]);

    const latestByStaff = firstPerKey(employmentRows, (row) => row.staffId);

    // PTO disclosure: viewing another person's leave *reason* is a manager/admin
    // capability (`pto:[review]`). This page is public, so we surface only
    // availability ("Away") to every viewer and reveal the leave type solely to
    // those who hold `pto:[review]`. A deliberate, minimal disclosure — NOT a
    // loosening of the PTO gate. Only approved (non-pending) leave is shown.
    // `currentUser` is non-null here — the read returned early without a session.
    const canSeePtoType = userHasPermission(currentUser, { pto: ["review"] });
    // Allocation notes are manager/admin-only staffing metadata. Gate both the
    // read here (never ship the value to an unprivileged client) and the write
    // (`updateStaffAllocationNotes`) on `staff.edit`.
    const canEditNotes = userHasPermission(currentUser, { staff: ["edit"] });
    // Allocating a person to an open role writes a project role, so gate the
    // per-row "Allocate" button (and its actions) on `projects.edit` — the same
    // capability the opportunity planner's staffing uses.
    const canAllocate = userHasPermission(currentUser, { projects: ["edit"] });

    const staffList: AllocationStaffRow[] = staffRows.map((s) => {
      const employment = latestByStaff.get(s.id);
      return {
        id: s.id,
        name: s.name,
        skills: s.skills,
        lineOfBusiness: employment?.lineOfBusiness ?? null,
        role: employment?.role ?? null,
        employmentType: employment?.employmentType ?? null,
        isBillable: employment?.isBillable ?? null,
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

    // Open positions: the same live spans with nobody in them yet. Kept as a
    // separate array rather than a nullable `staffId` on `roles` so every existing
    // consumer of `roles` (the planner grid, availability, utilization) keeps its
    // "one row = one person" guarantee and can't accidentally count a vacancy as a
    // person. The home dashboard's upcoming-roles panel is the one reader.
    const openRoles: OpenRoleRow[] = roleRows
      .filter((r) => r.staffId === null)
      .map((r) => ({
        id: r.id,
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

    return {
      staff: staffList,
      roles,
      openRoles,
      timeOff,
      canEditNotes,
      canAllocate,
    };
  },
);
