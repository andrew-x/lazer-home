/**
 * Pure grid math for the opportunity planner (the weekly, Gantt-like view in the
 * Project plan tab). A client-importable module (no `db`/drizzle, no React) so
 * the tricky bits — the week-column spine, one row per role, and each week's
 * own-role load plus the assignee's other commitments — stay unit-testable and
 * the component is render + action-wiring only. Reuses `weekPercent` from the
 * allocations grid so both planners agree on what a week's load is. See
 * docs/domains/projects.md.
 */

import type {
  ExternalAllocation,
  PlanRole,
} from "@/actions/projects/getOpportunityPlan";
import { weekPercent } from "@/lib/allocations/allocations-grid";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import { parseIsoDate } from "@/lib/format/format";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import {
  PROJECT_ROLE_TYPE_LABELS,
  type ProjectRoleType,
} from "@/lib/projects/project-role-type";
import {
  eachWeek,
  getWeekDays,
  getWeekStart,
} from "@/lib/timesheets/timesheet-week";

/** This role's own load in a single week cell (its share of a 40-hour week). */
export type OwnBlock = {
  /** Share of a 40-hour week this role takes that week (0–100). */
  percent: number;
  /** This is the role's first week — its start falls in this column. */
  isStart: boolean;
  /** This is the role's last week — its end falls in this column. */
  isEnd: boolean;
};

/**
 * One of the assigned person's commitments on **another** project within a week
 * cell — rendered greyed behind this role, mirroring the allocations grid block.
 */
export type ExternalBlock = {
  roleId: string;
  projectName: string;
  percent: number;
  status: ProjectRoleStatus;
  roleType: ProjectRoleType;
  lineOfBusiness: LineOfBusiness;
  description: string | null;
  startDate: string;
  endDate: string;
  isStart: boolean;
  isEnd: boolean;
};

/** One (role, week) cell: this role's block plus any greyed other commitments. */
export type PlannerCell = { own: OwnBlock | null; external: ExternalBlock[] };

/** A planner row: exactly one project role, with its week-aligned cells. */
export type PlannerRow = {
  key: string;
  roleId: string;
  /** The role's display name: its description, else the role-type label. */
  roleLabel: string;
  roleTypeLabel: string;
  hoursPerDay: number;
  status: ProjectRoleStatus;
  /** True only for this opportunity's own tentative role — the rest are read-only. */
  editable: boolean;
  staffId: string | null;
  staffName: string | null;
  startDate: string;
  endDate: string;
  /** One entry per column in the driving `weekColumns`, in the same order. */
  weeks: PlannerCell[];
};

/**
 * The week-column spine: every ISO-Monday from the earliest role start to the
 * latest role end. `[]` when there are no roles. External commitments outside
 * this window simply don't render — the spine tracks this project's own work.
 */
export function buildWeekColumns(roles: PlanRole[]): string[] {
  if (roles.length === 0) return [];
  let min = roles[0].startDate;
  let max = roles[0].endDate;
  for (const role of roles) {
    if (role.startDate < min) min = role.startDate;
    if (role.endDate > max) max = role.endDate;
  }
  return eachWeek(min, max);
}

/** Whether a role is this opportunity's own, still-editable (tentative) line. */
function isEditable(role: PlanRole, currentOpportunityId: string): boolean {
  return (
    role.status === "tentative" && role.opportunityId === currentOpportunityId
  );
}

/**
 * One row per role (staffed or placeholder). Each week cell carries this role's
 * own load and — for a staffed role — the assignee's other-project commitments
 * greyed behind it. `currentOpportunityId` drives per-role editability. Rows are
 * ordered so a person's roles sit together: staffed roles first (by staff name),
 * then open positions; within a person, by role type, then start date.
 */
export function buildPlannerRows(
  roles: PlanRole[],
  externalAllocations: ExternalAllocation[],
  weekColumns: string[],
  currentOpportunityId: string,
): PlannerRow[] {
  const externalByStaff = new Map<string, ExternalAllocation[]>();
  for (const ext of externalAllocations) {
    const list = externalByStaff.get(ext.staffId) ?? [];
    list.push(ext);
    externalByStaff.set(ext.staffId, list);
  }

  const rows: PlannerRow[] = roles.map((role) => {
    const external = role.staffId
      ? (externalByStaff.get(role.staffId) ?? [])
      : [];

    const weeks: PlannerCell[] = weekColumns.map((week) => {
      const percent = weekPercent(role, week);
      const own: OwnBlock | null =
        percent > 0
          ? {
              percent,
              isStart: getWeekStart(role.startDate) === week,
              isEnd: getWeekStart(role.endDate) === week,
            }
          : null;

      const externalBlocks: ExternalBlock[] = [];
      for (const ext of external) {
        const extPercent = weekPercent(ext, week);
        if (extPercent === 0) continue;
        externalBlocks.push({
          roleId: ext.roleId,
          projectName: ext.projectName,
          percent: extPercent,
          status: ext.status,
          roleType: ext.roleType,
          lineOfBusiness: ext.lineOfBusiness,
          description: ext.description,
          startDate: ext.startDate,
          endDate: ext.endDate,
          isStart: getWeekStart(ext.startDate) === week,
          isEnd: getWeekStart(ext.endDate) === week,
        });
      }
      externalBlocks.sort((a, b) => b.percent - a.percent);

      return { own, external: externalBlocks };
    });

    return {
      key: `role:${role.id}`,
      roleId: role.id,
      roleLabel: role.description ?? PROJECT_ROLE_TYPE_LABELS[role.roleType],
      roleTypeLabel: PROJECT_ROLE_TYPE_LABELS[role.roleType],
      hoursPerDay: role.hoursPerDay,
      status: role.status,
      editable: isEditable(role, currentOpportunityId),
      staffId: role.staffId,
      staffName: role.staffName,
      startDate: role.startDate,
      endDate: role.endDate,
      weeks,
    };
  });

  return rows.sort((a, b) => {
    // Staffed roles before open positions.
    const aStaffed = a.staffId !== null;
    const bStaffed = b.staffId !== null;
    if (aStaffed !== bStaffed) return aStaffed ? -1 : 1;
    // Keep a person's roles adjacent, alphabetically by name.
    const nameCmp = (a.staffName ?? "").localeCompare(b.staffName ?? "");
    if (nameCmp !== 0) return nameCmp;
    // Within a person (or among open positions), by role type, then start date.
    const typeCmp = a.roleTypeLabel.localeCompare(b.roleTypeLabel);
    if (typeCmp !== 0) return typeCmp;
    return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
  });
}

/** A short "Mon D" for a single date. */
function shortDay(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parseIsoDate(date));
}

/** A week column header showing the full week span, e.g. "Aug 3 – Aug 9". */
export function weekColumnLabel(weekStart: string): string {
  const days = getWeekDays(weekStart);
  return `${shortDay(days[0])} – ${shortDay(days[6])}`;
}
