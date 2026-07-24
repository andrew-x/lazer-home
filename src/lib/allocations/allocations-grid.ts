/**
 * Pure grid math for the Allocations planner (rows = active staff, columns =
 * weeks). A client-importable module (no `db`/drizzle, no React) so the tricky
 * bits — the week-column spine, per-week allocation percentages, and folding
 * staff + roles + time off into one row per person — stay simple and testable
 * and the component is render-only. Mirrors `@/lib/projects/project-planner-grid`
 * and reuses the timesheet week math. See docs/domains/allocations.md.
 */

import type {
  AllocationRoleRow,
  AllocationStaffRow,
  AllocationTimeOff,
} from "@/actions/allocations/getAllocationsGrid";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import { parseIsoDate } from "@/lib/format/format";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";
import type { PtoType } from "@/lib/staff/staff-enums";
import {
  addWeeks,
  currentWeekStart,
  eachWeek,
  getWeekDays,
  getWeekStart,
  isWeekend,
} from "@/lib/timesheets/timesheet-week";

/** A full week of billable capacity — the 100% baseline (8h/day × 5 weekdays). */
const HOURS_PER_FULL_WEEK = 40;

/** Default number of week columns shown before the user picks a range. */
export const DEFAULT_WINDOW_WEEKS = 12;

/** One project allocation within a single week cell. */
export type AllocationCell = {
  roleId: string;
  projectId: string;
  projectName: string;
  roleType: ProjectRoleType;
  status: ProjectRoleStatus;
  lineOfBusiness: LineOfBusiness;
  description: string | null;
  startDate: string;
  endDate: string;
  /** The role's daily hours — its nominal weekly load is `hoursPerDay × 5`. */
  hoursPerDay: number;
  /** Share of a 40-hour week this allocation takes that week (0–100). */
  percent: number;
  /** This is the role's first week — its start falls in this column. */
  isStart: boolean;
  /** This is the role's last week — its end falls in this column. */
  isEnd: boolean;
};

/** Weekdays in a standard working week — the basis for hrs/week and the 100% mark. */
export const WORKING_DAYS_PER_WEEK = 5;

/**
 * Time off overlapping a week. `percent` is the share of the working week the
 * person is away (away weekdays / 5). `type` is null unless the viewer may see
 * it. `startDate`/`endDate` are the extent of the overlapping leave span(s) —
 * availability info, shown to everyone (see the disclosure note in
 * `getAllocationsGrid`).
 */
export type TimeOffCell = {
  type: PtoType | null;
  percent: number;
  startDate: string;
  endDate: string;
};

/** One (person, week) cell: any allocations that week, plus any time off. */
export type WeekCell = {
  allocations: AllocationCell[];
  timeOff: TimeOffCell | null;
};

/** A planner row: one person and their week-aligned cells. */
export type AllocationRow = {
  staffId: string;
  name: string;
  role: AllocationStaffRow["role"];
  lineOfBusiness: AllocationStaffRow["lineOfBusiness"];
  employmentType: AllocationStaffRow["employmentType"];
  /** One entry per column in the driving `weekColumns`, in the same order. */
  weeks: WeekCell[];
};

/** The default window: the current week through the next 11 (12 columns). */
export function defaultWindow(): { start: string; end: string } {
  const start = currentWeekStart();
  return { start, end: addWeeks(start, DEFAULT_WINDOW_WEEKS - 1) };
}

/** The ISO-Monday week-column spine spanning `start`→`end` inclusive. */
export function buildWeekColumns(start: string, end: string): string[] {
  return eachWeek(start, end);
}

/** Compact working-week range for a column header, e.g. "Jul 6–10" / "Jun 29–Jul 3". */
export function weekColumnLabel(weekStart: string): string {
  const monday = parseIsoDate(weekStart);
  const friday = parseIsoDate(getWeekDays(weekStart)[4]);
  const month = new Intl.DateTimeFormat("en-US", { month: "short" });
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric" });
  const startMonth = month.format(monday);
  const endMonth = month.format(friday);
  return startMonth === endMonth
    ? `${startMonth} ${day.format(monday)}–${day.format(friday)}`
    : `${startMonth} ${day.format(monday)}–${endMonth} ${day.format(friday)}`;
}

/** Count of Mon–Fri days in `weekStart`'s week that fall within [start, end]. */
function activeWeekdays(weekStart: string, start: string, end: string): number {
  let count = 0;
  for (const day of getWeekDays(weekStart)) {
    if (isWeekend(day)) continue;
    if (day >= start && day <= end) count += 1;
  }
  return count;
}

/** Mon–Fri days in `weekStart`'s week covered by any of the time-off `spans` (deduped). */
function awayWeekdays(
  weekStart: string,
  spans: readonly AllocationTimeOff[],
): number {
  let count = 0;
  for (const day of getWeekDays(weekStart)) {
    if (isWeekend(day)) continue;
    if (spans.some((span) => day >= span.startDate && day <= span.endDate)) {
      count += 1;
    }
  }
  return count;
}

/** The leave type of the first time-off span overlapping the week (null if hidden). */
function firstAwayType(
  weekStart: string,
  spans: readonly AllocationTimeOff[],
): PtoType | null {
  const span = spans.find(
    (s) => activeWeekdays(weekStart, s.startDate, s.endDate) > 0,
  );
  return span ? span.type : null;
}

/**
 * The extent (min start, max end) of the time-off spans overlapping the week,
 * or null when none do. Merges any concurrent spans into one outer range so the
 * away tooltip can show when the leave actually runs.
 */
function awaySpanRange(
  weekStart: string,
  spans: readonly AllocationTimeOff[],
): { startDate: string; endDate: string } | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const span of spans) {
    if (activeWeekdays(weekStart, span.startDate, span.endDate) === 0) continue;
    if (start === null || span.startDate < start) start = span.startDate;
    if (end === null || span.endDate > end) end = span.endDate;
  }
  return start && end ? { startDate: start, endDate: end } : null;
}

/**
 * The share of a 40-hour week a role occupies in the given week:
 * `hoursPerDay × (its active weekdays that week) / 40`, rounded and capped at
 * 100. Zero when the role doesn't touch any weekday of the week. This is how a
 * mid-week end date or a part-day (e.g. 4h/day → 50%) shows up as a partial %.
 */
export function weekPercent(
  role: Pick<AllocationRoleRow, "startDate" | "endDate" | "hoursPerDay">,
  weekStart: string,
): number {
  const days = activeWeekdays(weekStart, role.startDate, role.endDate);
  if (days === 0) return 0;
  const percent = ((role.hoursPerDay * days) / HOURS_PER_FULL_WEEK) * 100;
  return Math.min(100, Math.round(percent));
}

/** Group rows into a Map keyed by `getKey`, preserving input order per key. */
function groupBy<T, K>(rows: readonly T[], getKey: (row: T) => K): Map<K, T[]> {
  const byKey = new Map<K, T[]>();
  for (const row of rows) {
    const key = getKey(row);
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  return byKey;
}

/**
 * The latest end date across a person's **confirmed** roles, or null when they
 * have none. This is "when they next free up" — the key the default sort uses
 * to surface available people first (see {@link buildAllocationRows}).
 */
function latestConfirmedEnd(
  personRoles: readonly AllocationRoleRow[],
): string | null {
  let latest: string | null = null;
  for (const role of personRoles) {
    if (role.status !== "confirmed") continue;
    if (latest === null || role.endDate > latest) latest = role.endDate;
  }
  return latest;
}

/**
 * Fold active staff + their role spans + time off into planner rows aligned to
 * `weekColumns`. Within a week cell, allocations are sorted by descending
 * percentage so the heaviest commitment reads first.
 *
 * Rows are ordered to surface capacity: people with **no confirmed roles** come
 * first, then everyone else in increasing order of when their confirmed work
 * ends (soonest-to-free first). Ties break by name. Only confirmed roles count
 * — a purely tentative allocation doesn't commit the person.
 */
export function buildAllocationRows(
  staff: readonly AllocationStaffRow[],
  roles: readonly AllocationRoleRow[],
  timeOff: readonly AllocationTimeOff[],
  weekColumns: readonly string[],
): AllocationRow[] {
  const rolesByStaff = groupBy(roles, (r) => r.staffId);
  const timeOffByStaff = groupBy(timeOff, (t) => t.staffId);

  const built = staff.map((person) => {
    const personRoles = rolesByStaff.get(person.id) ?? [];
    const personTimeOff = timeOffByStaff.get(person.id) ?? [];

    const weeks: WeekCell[] = weekColumns.map((weekStart) => {
      const allocations: AllocationCell[] = [];
      for (const role of personRoles) {
        const percent = weekPercent(role, weekStart);
        if (percent === 0) continue;
        allocations.push({
          roleId: role.id,
          projectId: role.projectId,
          projectName: role.projectName,
          roleType: role.roleType,
          status: role.status,
          lineOfBusiness: role.lineOfBusiness,
          description: role.description,
          startDate: role.startDate,
          endDate: role.endDate,
          hoursPerDay: role.hoursPerDay,
          percent,
          isStart: getWeekStart(role.startDate) === weekStart,
          isEnd: getWeekStart(role.endDate) === weekStart,
        });
      }
      allocations.sort((a, b) => b.percent - a.percent);

      const awayDays = awayWeekdays(weekStart, personTimeOff);
      const awayRange = awaySpanRange(weekStart, personTimeOff);
      const timeOff: TimeOffCell | null =
        awayDays > 0 && awayRange
          ? {
              type: firstAwayType(weekStart, personTimeOff),
              percent: Math.round((awayDays / WORKING_DAYS_PER_WEEK) * 100),
              startDate: awayRange.startDate,
              endDate: awayRange.endDate,
            }
          : null;
      return { allocations, timeOff };
    });

    const row: AllocationRow = {
      staffId: person.id,
      name: person.name,
      role: person.role,
      lineOfBusiness: person.lineOfBusiness,
      employmentType: person.employmentType,
      weeks,
    };
    return { row, confirmedEnd: latestConfirmedEnd(personRoles) };
  });

  built.sort((a, b) => {
    // No confirmed roles → top (most available). Then ascending end date.
    if (a.confirmedEnd === null || b.confirmedEnd === null) {
      if (a.confirmedEnd !== b.confirmedEnd)
        return a.confirmedEnd === null ? -1 : 1;
    } else if (a.confirmedEnd !== b.confirmedEnd) {
      return a.confirmedEnd < b.confirmedEnd ? -1 : 1;
    }
    return a.row.name.localeCompare(b.row.name);
  });

  return built.map((entry) => entry.row);
}
