/**
 * Who is free, when — the home dashboard's staffing forecast, plus the upcoming
 * leave list that sits beside it. A pure, client-importable module (no `db`/drizzle,
 * no React) folding the same `{ staff, roles, timeOff }` the allocations planner
 * reads (`getAllocationsGrid`). See docs/domains/allocations.md.
 *
 * The rules, all deliberate:
 *
 * - **Confirmed roles commit a person; tentative ones don't.** A tentative
 *   allocation is a plan, not a commitment — the same rule `latestConfirmedEnd`
 *   already applies for the planner's default sort. Tentative coverage is reported
 *   separately (`tentativePercent`, `tentativeCount`) so the UI can say "5 free,
 *   2 pencilled in" instead of hiding capacity that hasn't been sold yet.
 * - **Approved leave blocks availability.** Somebody 0% allocated but on vacation
 *   all of week +2 is not available in week +2, and saying otherwise is what gets
 *   a staffing widget distrusted after one bad call.
 * - **Availability is graded, then thresholded** at {@link AVAILABLE_THRESHOLD_PERCENT}.
 *   A strict "0% allocated" rule reports nobody in a healthy consultancy and the
 *   widget becomes decoration; most staffing asks are "half a body or a whole one".
 * - **Counts include a person in every week they're free** — "who's free in three
 *   weeks" is a question people ask directly, and a soonest-bucket-only model
 *   can't answer it. `freeFrom` carries the *first* free week so name lists can key
 *   each person to one row without losing the other cells.
 * - **Non-billable staff are excluded** (the employment fact, not `isBillableRole`),
 *   or ops and leadership occupy the bench forever and it stops being read.
 *
 * Weekday counting has no statutory-holiday calendar — see `@/lib/allocations/weekdays`.
 */

import type {
  AllocationRoleRow,
  AllocationStaffRow,
  AllocationTimeOff,
} from "@/actions/allocations/getAllocationsGrid";
import { weekPercent } from "@/lib/allocations/allocations-grid";
import { awayWeekdays, totalWeekdays } from "@/lib/allocations/weekdays";
import { groupPerKey } from "@/lib/core/collections";
import { countWorkingDays } from "@/lib/staff/pto-working-days";
import type { PtoType } from "@/lib/staff/staff-enums";
import {
  addDays,
  addWeeks,
  getWeekDays,
} from "@/lib/timesheets/timesheet-week";

/** Columns in the forecast strip: the current week plus the next four. */
export const AVAILABILITY_WEEKS = 5;

/**
 * How much of a week must be free before someone counts as available. Named and
 * exported so the number is arguable rather than buried in a comparison.
 */
export const AVAILABLE_THRESHOLD_PERCENT = 50;

/** How far ahead the "upcoming time off" list looks. */
export const UPCOMING_TIME_OFF_HORIZON_DAYS = 30;

/** One person's load in one week, as whole percents of a full working week. */
export type WeekLoad = {
  weekStart: string;
  /** Confirmed allocation, capped at 100 — committed work. */
  confirmedPercent: number;
  /** Tentative allocation, capped at 100 — pencilled in, not committed. */
  tentativePercent: number;
  /** Share of the week's working days covered by approved leave. */
  awayPercent: number;
  /** What's left: `100 − confirmed − away`, floored at 0. */
  freePercent: number;
};

/** A person in the forecast, with one entry per column in the driving week list. */
export type AvailabilityPerson = {
  staffId: string;
  name: string;
  role: AllocationStaffRow["role"];
  lineOfBusiness: AllocationStaffRow["lineOfBusiness"];
  employmentType: AllocationStaffRow["employmentType"];
  weeks: WeekLoad[];
  /** The first week they clear the threshold, or null if they never do. */
  freeFrom: string | null;
  /** They hold tentative work in the window but nothing confirmed. */
  tentativeOnly: boolean;
};

/** One column of the forecast strip. */
export type AvailabilityWeek = {
  weekStart: string;
  /** People clearing {@link AVAILABLE_THRESHOLD_PERCENT} this week. */
  availableCount: number;
  /** How many of those are pencilled in on tentative work. */
  tentativeCount: number;
  /**
   * Spare capacity across the whole population, in full-time equivalents —
   * the number a staffing lead acts on. Five half-free people and five
   * fully-free people are very different weeks, and a headcount hides that.
   */
  freeFte: number;
};

/** One approved leave span in the upcoming list. */
export type UpcomingLeave = {
  staffId: string;
  name: string;
  startDate: string;
  endDate: string;
  /** Mon–Fri days in the span. */
  workingDays: number;
  /** Null unless the viewer holds `pto.review` — masked upstream by the read. */
  type: PtoType | null;
  /** Days until it starts; 0 for leave already under way. */
  startsInDays: number;
  /** The person is away right now. */
  ongoing: boolean;
};

/** Whole days between two ISO dates, computed in UTC to sidestep DST. */
function daysBetween(from: string, to: string): number {
  const dayNumber = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  };
  return dayNumber(to) - dayNumber(from);
}

/** Active staff in billable employment — the population every capacity figure uses. */
function billableStaff(
  staff: readonly AllocationStaffRow[],
): AllocationStaffRow[] {
  return staff.filter((person) => person.isBillable === true);
}

function loadFor(
  personRoles: readonly AllocationRoleRow[],
  personTimeOff: readonly AllocationTimeOff[],
  weekStart: string,
): WeekLoad {
  const sumPercent = (status: AllocationRoleRow["status"]) =>
    Math.min(
      100,
      personRoles
        .filter((role) => role.status === status)
        .reduce((sum, role) => sum + weekPercent(role, weekStart), 0),
    );

  const weekEnd = getWeekDays(weekStart)[6];
  const workingDays = totalWeekdays(weekStart, weekEnd);
  const away = awayWeekdays(weekStart, weekEnd, personTimeOff);
  const awayPercent =
    workingDays > 0 ? Math.round((away / workingDays) * 100) : 0;

  const confirmedPercent = sumPercent("confirmed");
  return {
    weekStart,
    confirmedPercent,
    tentativePercent: sumPercent("tentative"),
    awayPercent,
    freePercent: Math.max(0, 100 - confirmedPercent - awayPercent),
  };
}

/**
 * Fold staff + roles + approved leave into a {@link AVAILABILITY_WEEKS}-column
 * forecast starting at `fromWeek` (an ISO Monday). People are returned sorted by
 * how soon they free up — never-free last — then by name, so the caller can slice
 * name lists off the front without re-sorting.
 */
export function buildAvailability(
  staff: readonly AllocationStaffRow[],
  roles: readonly AllocationRoleRow[],
  timeOff: readonly AllocationTimeOff[],
  fromWeek: string,
): { weeks: AvailabilityWeek[]; people: AvailabilityPerson[] } {
  const weekStarts = Array.from({ length: AVAILABILITY_WEEKS }, (_, i) =>
    addWeeks(fromWeek, i),
  );
  const rolesByStaff = groupPerKey(roles, (role) => role.staffId);
  const timeOffByStaff = groupPerKey(timeOff, (span) => span.staffId);
  const windowEnd = getWeekDays(weekStarts[weekStarts.length - 1])[6];

  const people: AvailabilityPerson[] = billableStaff(staff).map((person) => {
    const personRoles = rolesByStaff.get(person.id) ?? [];
    const personTimeOff = timeOffByStaff.get(person.id) ?? [];
    const weeks = weekStarts.map((weekStart) =>
      loadFor(personRoles, personTimeOff, weekStart),
    );

    // "In the window" for the tentative-only flag means overlapping any column,
    // not merely existing — a role that ended last month says nothing about now.
    const inWindow = personRoles.filter(
      (role) => role.startDate <= windowEnd && role.endDate >= fromWeek,
    );

    return {
      staffId: person.id,
      name: person.name,
      role: person.role,
      lineOfBusiness: person.lineOfBusiness,
      employmentType: person.employmentType,
      weeks,
      freeFrom:
        weeks.find((week) => week.freePercent >= AVAILABLE_THRESHOLD_PERCENT)
          ?.weekStart ?? null,
      tentativeOnly:
        inWindow.length > 0 &&
        inWindow.every((role) => role.status === "tentative"),
    };
  });

  const weeks: AvailabilityWeek[] = weekStarts.map((weekStart, index) => {
    const loads = people.map((person) => person.weeks[index]);
    const available = loads.filter(
      (load) => load.freePercent >= AVAILABLE_THRESHOLD_PERCENT,
    );
    return {
      weekStart,
      availableCount: available.length,
      tentativeCount: available.filter((load) => load.tentativePercent > 0)
        .length,
      freeFte: loads.reduce((sum, load) => sum + load.freePercent, 0) / 100,
    };
  });

  people.sort((a, b) => {
    if (a.freeFrom !== b.freeFrom) {
      if (a.freeFrom === null) return 1;
      if (b.freeFrom === null) return -1;
      return a.freeFrom < b.freeFrom ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return { weeks, people };
}

/**
 * Approved leave running or starting within `horizonDays` of `today`, soonest
 * first. Only people still on staff appear (the read already filters to active
 * staff). `type` is passed straight through from the read, which has already
 * decided whether the viewer may see the leave reason — never re-derive it here.
 */
export function buildUpcomingTimeOff(
  staff: readonly AllocationStaffRow[],
  timeOff: readonly AllocationTimeOff[],
  today: string,
  horizonDays: number = UPCOMING_TIME_OFF_HORIZON_DAYS,
): UpcomingLeave[] {
  const nameById = new Map(staff.map((person) => [person.id, person.name]));
  const horizonEnd = addDays(today, horizonDays);

  return timeOff
    .filter(
      (span) =>
        span.endDate >= today &&
        span.startDate <= horizonEnd &&
        nameById.has(span.staffId),
    )
    .map((span) => {
      const startsInDays = daysBetween(today, span.startDate);
      return {
        staffId: span.staffId,
        name: nameById.get(span.staffId) as string,
        startDate: span.startDate,
        endDate: span.endDate,
        workingDays: countWorkingDays(span.startDate, span.endDate),
        type: span.type,
        startsInDays: Math.max(0, startsInDays),
        ongoing: startsInDays <= 0,
      };
    })
    .sort((a, b) =>
      a.startDate === b.startDate
        ? a.name.localeCompare(b.name)
        : a.startDate < b.startDate
          ? -1
          : 1,
    );
}
