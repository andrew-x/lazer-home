/**
 * Pure grid math for the opportunity planner (the weekly, Gantt-like view in the
 * Project plan tab). A client-importable module (no `db`/drizzle, no React) so
 * the tricky bits — the week-column spine, grouping roles into person-rows, and
 * marking which weeks each row is active — stay unit-testable and the component
 * is render + action-wiring only. Mirrors `timesheet-grid.ts`. See
 * docs/domains/projects.md.
 */

import type { PlanRole } from "@/actions/projects/getOpportunityPlan";
import { parseIsoDate } from "@/lib/format";
import type { ProjectRoleStatus } from "@/lib/project-role-status";
import {
  PROJECT_ROLE_TYPE_LABELS,
  type ProjectRoleType,
} from "@/lib/project-role-type";
import { eachWeek, getWeekStart } from "@/lib/timesheet-week";

/** One role record as a planner block: the weeks it spans and its edit state. */
export type RoleSegment = {
  roleId: string;
  // ISO-Monday bounds (the role's start/end weeks), for block placement.
  startWeek: string;
  endWeek: string;
  startDate: string;
  endDate: string;
  status: ProjectRoleStatus;
  // True only for this opportunity's own tentative roles — the rest render
  // greyed and read-only.
  editable: boolean;
  roleType: ProjectRoleType;
  hoursPerDay: number;
  description: string | null;
  opportunityId: string | null;
};

/** A planner row: a person (with all their segments) or one placeholder role. */
export type PlannerRow = {
  key: string;
  label: string;
  sublabel: string | null;
  staffId: string | null;
  segments: RoleSegment[];
  // Per week column: true if any of the row's segments covers that week.
  active: boolean[];
};

/**
 * The week-column spine: every ISO-Monday from the earliest role start to the
 * latest role end. `[]` when there are no roles.
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

function toSegment(role: PlanRole, currentOpportunityId: string): RoleSegment {
  return {
    roleId: role.id,
    startWeek: getWeekStart(role.startDate),
    endWeek: getWeekStart(role.endDate),
    startDate: role.startDate,
    endDate: role.endDate,
    status: role.status,
    editable: isEditable(role, currentOpportunityId),
    roleType: role.roleType,
    hoursPerDay: role.hoursPerDay,
    description: role.description,
    opportunityId: role.opportunityId,
  };
}

/** The distinct role-type labels across a row's segments, comma-joined. */
function typeSublabel(segments: RoleSegment[]): string {
  const labels: string[] = [];
  for (const s of segments) {
    const label = PROJECT_ROLE_TYPE_LABELS[s.roleType];
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.join(", ");
}

/** Which of `weekColumns` any segment covers (inclusive, ISO-Monday compare). */
function activeWeeks(
  segments: RoleSegment[],
  weekColumns: string[],
): boolean[] {
  return weekColumns.map((week) =>
    segments.some((s) => week >= s.startWeek && week <= s.endWeek),
  );
}

/**
 * Group roles into planner rows: one row per staffed person (all their role
 * segments together, so an extension shows as another block on the same line),
 * and one row per placeholder (null-staff) role. Staffed rows come first,
 * alphabetically; placeholders follow. `currentOpportunityId` drives per-segment
 * editability.
 */
export function buildPlannerRows(
  roles: PlanRole[],
  weekColumns: string[],
  currentOpportunityId: string,
): PlannerRow[] {
  const byStaff = new Map<string, PlanRole[]>();
  const placeholders: PlanRole[] = [];

  for (const role of roles) {
    if (role.staffId) {
      const list = byStaff.get(role.staffId) ?? [];
      list.push(role);
      byStaff.set(role.staffId, list);
    } else {
      placeholders.push(role);
    }
  }

  const staffedRows: PlannerRow[] = [];
  for (const [staffId, staffRoles] of byStaff) {
    const segments = staffRoles.map((r) => toSegment(r, currentOpportunityId));
    staffedRows.push({
      key: `staff:${staffId}`,
      label: staffRoles[0].staffName ?? "Unknown",
      sublabel: typeSublabel(segments),
      staffId,
      segments,
      active: activeWeeks(segments, weekColumns),
    });
  }
  staffedRows.sort((a, b) => a.label.localeCompare(b.label));

  const placeholderRows: PlannerRow[] = placeholders
    .map((role) => {
      const segments = [toSegment(role, currentOpportunityId)];
      return {
        key: `role:${role.id}`,
        label: role.description ?? PROJECT_ROLE_TYPE_LABELS[role.roleType],
        sublabel: "Open position",
        staffId: null,
        segments,
        active: activeWeeks(segments, weekColumns),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return [...staffedRows, ...placeholderRows];
}

/** A short "Mon D" → "Mon D" label for a week column header. */
export function weekColumnLabel(weekStart: string): string {
  const monday = parseIsoDate(weekStart);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(monday);
}
