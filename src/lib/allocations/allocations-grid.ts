/**
 * Pure grid math for the Allocations planner (rows = active staff, columns =
 * time buckets). A client-importable module (no `db`/drizzle, no React) so the
 * tricky bits — the column spine, per-column allocation percentages, and folding
 * staff + roles + time off into one row per person — stay simple and testable
 * and the component is render-only. Mirrors `@/lib/projects/project-planner-grid`
 * and reuses the timesheet week math. See docs/domains/allocations.md.
 *
 * Columns come at three granularities — **day**, **week**, or **month**. A role's
 * cell shows the same underlying rate (`hoursPerDay / 8h`, e.g. 4h/day → 50%)
 * whatever the granularity; the granularity only changes how wide a column is and
 * how the start/end edges land. Weeks additionally prorate their partial start/end
 * columns (the historical behavior); days are atomic and months show the flat rate.
 *
 * A cell also reports what's **left** ({@link CapacityCell}). That is a different
 * number from the per-role rates above and computed differently — see
 * {@link bucketLoadPercent}.
 */

import type {
  AllocationRoleRow,
  AllocationStaffRow,
  AllocationTimeOff,
} from "@/actions/allocations/getAllocationsGrid";
import {
  activeWeekdays,
  awayWeekdays,
  latestConfirmedEnd,
  totalWeekdays,
} from "@/lib/allocations/weekdays";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import { parseIsoDate } from "@/lib/format/format";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";
import type { PtoType } from "@/lib/staff/staff-enums";
import {
  addDays,
  addMonths,
  addWeeks,
  currentDay,
  currentMonthStart,
  currentWeekStart,
  eachDay,
  eachMonth,
  eachWeek,
  getMonthStart,
  getWeekDays,
  getWeekStart,
} from "@/lib/timesheets/timesheet-week";

/** A full week of billable capacity — the 100% baseline (8h/day × 5 weekdays). */
const HOURS_PER_FULL_WEEK = 40;

/** Weekdays in a standard working week — the basis for hrs/week and the 100% mark. */
export const WORKING_DAYS_PER_WEEK = 5;

/**
 * A full working day — the 100% baseline for a single day / the nominal rate.
 * Exported so the utilization report's available-hours denominator is the same
 * 8h day this grid calls 100%, rather than a second copy of the constant.
 */
export const HOURS_PER_DAY = HOURS_PER_FULL_WEEK / WORKING_DAYS_PER_WEEK;

/** The width of a planner column: a single day, an ISO week, or a calendar month. */
export type Granularity = "day" | "week" | "month";

/** Granularities in display order — drives the planner's segmented toggle. */
export const GRANULARITIES: Granularity[] = ["day", "week", "month"];

/** Human labels for the granularity toggle. */
export const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: "Days",
  week: "Weeks",
  month: "Months",
};

/** Default column counts shown before the user picks a range, per granularity. */
export const DEFAULT_WINDOW: Record<Granularity, number> = {
  day: 14,
  week: 12,
  month: 6,
};

/**
 * A role's nominal rate as a whole-percent share of a full 8-hour day (capped at
 * 100). This is the steady-state percentage a cell shows in the body of a role's
 * span at any granularity — e.g. 4h/day → 50%, 8h/day → 100%.
 */
function nominalRatePercent(hoursPerDay: number): number {
  return Math.min(100, Math.round((hoursPerDay / HOURS_PER_DAY) * 100));
}

/** One project allocation within a single planner cell. */
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
  /** Share of the column this allocation takes (0–100). */
  percent: number;
  /** This column is the role's first — its start falls in this bucket. */
  isStart: boolean;
  /** This column is the role's last — its end falls in this bucket. */
  isEnd: boolean;
};

/**
 * Time off overlapping a column. `percent` is the share of the column's working
 * days the person is away (away weekdays / total weekdays in the bucket). `type`
 * is null unless the viewer may see it. `startDate`/`endDate` are the extent of
 * the overlapping leave span(s) — availability info, shown to everyone (see the
 * disclosure note in `getAllocationsGrid`).
 */
export type TimeOffCell = {
  type: PtoType | null;
  percent: number;
  startDate: string;
  endDate: string;
};

/**
 * How much of a column's working capacity is spoken for, and how much is left.
 *
 * Unlike the per-role percentages above — which are display *rates*, capped at
 * 100 and (at month granularity) not prorated — these are shares of the bucket's
 * real working days, summed across every project the person is on. Time off
 * *reduces* capacity rather than sitting beside it: capacity is `100 − away`, so
 * someone 40% away and 40% booked has 20% left, and someone fully away who is
 * also booked reads as over-allocated. Confirmed and tentative both consume
 * capacity — you don't double-sell a person who is pencilled in.
 *
 * Every figure is rounded from the raw sum, never summed from rounded parts, so
 * three 33.3% roles read "0% free" rather than "1% over".
 */
export type CapacityCell = {
  /** Share of the bucket taken by confirmed roles. */
  confirmedPercent: number;
  /** Share of the bucket taken by tentative roles. */
  tentativePercent: number;
  /** Share of the bucket's working days the person is away. */
  awayPercent: number;
  /** Confirmed + tentative — everything committed, soft or hard. */
  loadPercent: number;
  /** Capacity left: `100 − away − load`. Zero when over-allocated. */
  freePercent: number;
  /** How far past capacity the person is. Zero when within it. */
  overPercent: number;
};

/**
 * One (person, column) cell: any allocations that column, any time off, and how
 * much capacity is left. `capacity` is null when the bucket has no working days
 * at all (a weekend column in the daily view) — there is no capacity to report,
 * and "100% free on Saturday" would be noise.
 */
export type BucketCell = {
  allocations: AllocationCell[];
  timeOff: TimeOffCell | null;
  capacity: CapacityCell | null;
};

/** A planner row: one person and their column-aligned cells. */
export type AllocationRow = {
  staffId: string;
  name: string;
  role: AllocationStaffRow["role"];
  lineOfBusiness: AllocationStaffRow["lineOfBusiness"];
  employmentType: AllocationStaffRow["employmentType"];
  allocationNotes: AllocationStaffRow["allocationNotes"];
  /** One entry per column in the driving `columns`, in the same order. */
  cells: BucketCell[];
};

/**
 * The default window at a granularity: the current bucket through the next
 * `DEFAULT_WINDOW[granularity] − 1` (e.g. 14 days, 12 weeks, or 6 months).
 */
export function defaultWindow(granularity: Granularity): {
  start: string;
  end: string;
} {
  const span = DEFAULT_WINDOW[granularity] - 1;
  switch (granularity) {
    case "day": {
      const start = currentDay();
      return { start, end: addDays(start, span) };
    }
    case "week": {
      const start = currentWeekStart();
      return { start, end: addWeeks(start, span) };
    }
    case "month": {
      const start = currentMonthStart();
      return { start, end: addMonths(start, span) };
    }
  }
}

/** The column spine spanning `start`→`end` inclusive, at the given granularity. */
export function buildColumns(
  granularity: Granularity,
  start: string,
  end: string,
): string[] {
  switch (granularity) {
    case "day":
      return eachDay(start, end);
    case "week":
      return eachWeek(start, end);
    case "month":
      return eachMonth(start, end);
  }
}

/** The last day of the bucket a column starts on, for the given granularity. */
function bucketEnd(granularity: Granularity, colStart: string): string {
  switch (granularity) {
    case "day":
      return colStart;
    case "week":
      return getWeekDays(colStart)[6];
    case "month":
      return addDays(addMonths(colStart, 1), -1);
  }
}

/**
 * The start of the bucket `date` belongs to, for the given granularity. Shared
 * with the by-project grid (`./project-allocations-grid`) so both views mark a
 * role's start/end column by the same rule.
 */
export function getBucketStart(granularity: Granularity, date: string): string {
  switch (granularity) {
    case "day":
      return date;
    case "week":
      return getWeekStart(date);
    case "month":
      return getMonthStart(date);
  }
}

/** Compact working-week range for a week column, e.g. "Jul 6–10" / "Jun 29–Jul 3". */
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

/** Weekday + date for a day column, e.g. "Mon, Jul 6". */
function dayColumnLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(parseIsoDate(day));
}

/** Month + year for a month column, e.g. "Jul 2026". */
function monthColumnLabel(monthStart: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(parseIsoDate(monthStart));
}

/** A column header label appropriate to the granularity. */
export function columnLabel(
  granularity: Granularity,
  colStart: string,
): string {
  switch (granularity) {
    case "day":
      return dayColumnLabel(colStart);
    case "week":
      return weekColumnLabel(colStart);
    case "month":
      return monthColumnLabel(colStart);
  }
}

/** The leave type of the first time-off span overlapping the bucket (null if hidden). */
function firstAwayType(
  from: string,
  to: string,
  spans: readonly AllocationTimeOff[],
): PtoType | null {
  const span = spans.find(
    (s) => activeWeekdays(from, to, s.startDate, s.endDate) > 0,
  );
  return span ? span.type : null;
}

/**
 * The extent (min start, max end) of the time-off spans overlapping the bucket,
 * or null when none do. Merges any concurrent spans into one outer range so the
 * away tooltip can show when the leave actually runs.
 */
function awaySpanRange(
  from: string,
  to: string,
  spans: readonly AllocationTimeOff[],
): { startDate: string; endDate: string } | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const span of spans) {
    if (activeWeekdays(from, to, span.startDate, span.endDate) === 0) continue;
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
 * Reused by the opportunity project planner (`@/lib/projects/project-planner-grid`).
 */
export function weekPercent(
  role: Pick<AllocationRoleRow, "startDate" | "endDate" | "hoursPerDay">,
  weekStart: string,
): number {
  const days = activeWeekdays(
    weekStart,
    getWeekDays(weekStart)[6],
    role.startDate,
    role.endDate,
  );
  if (days === 0) return 0;
  const percent = ((role.hoursPerDay * days) / HOURS_PER_FULL_WEEK) * 100;
  return Math.min(100, Math.round(percent));
}

/**
 * The percentage a role occupies in a column at the given granularity:
 * - **week** — prorated by its active weekdays that week (see {@link weekPercent}).
 * - **day** — its nominal rate on an in-range weekday, else 0 (weekends are empty).
 * - **month** — its nominal rate for any month it's active in (not prorated).
 */
export function bucketPercent(
  role: Pick<AllocationRoleRow, "startDate" | "endDate" | "hoursPerDay">,
  granularity: Granularity,
  colStart: string,
): number {
  if (granularity === "week") return weekPercent(role, colStart);
  const active = activeWeekdays(
    colStart,
    bucketEnd(granularity, colStart),
    role.startDate,
    role.endDate,
  );
  if (active === 0) return 0;
  return nominalRatePercent(role.hoursPerDay);
}

/**
 * A role's real share of a column's working capacity — the figure the capacity
 * meter sums. Unlike {@link bucketPercent} it is **uncapped** and **prorated at
 * every granularity**, because these get added together across projects.
 *
 * At day and week that's arithmetically the same thing {@link bucketPercent}
 * shows (minus the cap). Only **month** diverges, and it has to: a role covering
 * half of March displays its nominal 100% rate (ADR 0040), so two back-to-back
 * half-month roles would naively sum to 200% for a person who is exactly full.
 * Here each contributes 50% and the person reads 0% free.
 *
 * Returns a raw float — callers round once, at the end, after summing.
 */
export function bucketLoadPercent(
  role: Pick<AllocationRoleRow, "startDate" | "endDate" | "hoursPerDay">,
  granularity: Granularity,
  colStart: string,
): number {
  const colEnd = bucketEnd(granularity, colStart);
  const total = totalWeekdays(colStart, colEnd);
  if (total === 0) return 0;
  const active = activeWeekdays(colStart, colEnd, role.startDate, role.endDate);
  if (active === 0) return 0;
  return ((role.hoursPerDay * active) / (HOURS_PER_DAY * total)) * 100;
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
 * Fold active staff + their role spans + time off into planner rows aligned to
 * `columns` at the given `granularity`. Within a cell, allocations are sorted by
 * descending percentage so the heaviest commitment reads first.
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
  columns: readonly string[],
  granularity: Granularity,
): AllocationRow[] {
  const rolesByStaff = groupBy(roles, (r) => r.staffId);
  const timeOffByStaff = groupBy(timeOff, (t) => t.staffId);

  const built = staff.map((person) => {
    const personRoles = rolesByStaff.get(person.id) ?? [];
    const personTimeOff = timeOffByStaff.get(person.id) ?? [];

    const cells: BucketCell[] = columns.map((colStart) => {
      const colEnd = bucketEnd(granularity, colStart);
      const allocations: AllocationCell[] = [];
      // Raw, uncapped, unrounded load — summed here and rounded once below.
      let confirmedLoad = 0;
      let tentativeLoad = 0;
      for (const role of personRoles) {
        // Only live work consumes capacity. The read already filters to
        // tentative + confirmed; naming both explicitly keeps a widened read
        // from quietly booking paused or cancelled roles against a person.
        const load = bucketLoadPercent(role, granularity, colStart);
        if (role.status === "confirmed") confirmedLoad += load;
        else if (role.status === "tentative") tentativeLoad += load;

        const percent = bucketPercent(role, granularity, colStart);
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
          isStart: getBucketStart(granularity, role.startDate) === colStart,
          isEnd: getBucketStart(granularity, role.endDate) === colStart,
        });
      }
      allocations.sort((a, b) => b.percent - a.percent);

      const workingDays = totalWeekdays(colStart, colEnd);
      const awayDays = awayWeekdays(colStart, colEnd, personTimeOff);
      const awayRange = awaySpanRange(colStart, colEnd, personTimeOff);
      const timeOff: TimeOffCell | null =
        awayDays > 0 && awayRange && workingDays > 0
          ? {
              type: firstAwayType(colStart, colEnd, personTimeOff),
              percent: Math.round((awayDays / workingDays) * 100),
              startDate: awayRange.startDate,
              endDate: awayRange.endDate,
            }
          : null;

      // Raw away share, not `timeOff.percent` — that one is already rounded.
      const awayLoad = workingDays > 0 ? (awayDays / workingDays) * 100 : 0;
      const remaining = 100 - awayLoad - confirmedLoad - tentativeLoad;
      const capacity: CapacityCell | null =
        workingDays > 0
          ? {
              confirmedPercent: Math.round(confirmedLoad),
              tentativePercent: Math.round(tentativeLoad),
              awayPercent: Math.round(awayLoad),
              loadPercent: Math.round(confirmedLoad + tentativeLoad),
              freePercent: Math.max(0, Math.round(remaining)),
              overPercent: Math.max(0, Math.round(-remaining)),
            }
          : null;

      return { allocations, timeOff, capacity };
    });

    const row: AllocationRow = {
      staffId: person.id,
      name: person.name,
      role: person.role,
      lineOfBusiness: person.lineOfBusiness,
      employmentType: person.employmentType,
      allocationNotes: person.allocationNotes,
      cells,
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
