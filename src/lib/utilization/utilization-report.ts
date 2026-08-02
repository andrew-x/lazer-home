/**
 * Pure math for the utilization report. A client-importable module (no `db`, no
 * React) so the read stays a projection and every definition below is testable in
 * isolation. See docs/domains/allocations.md and docs/domains/timesheets.md.
 *
 * The report carries **two series everywhere**, and never adds them together:
 *
 * - **Planned** — from `project_roles`, i.e. what we staffed. `hoursPerDay` over the
 *   working days a role covers, the same basis `roleBillableHours` uses in
 *   `@/lib/projects/project-margin`.
 * - **Confirmed** — from `time_entries` on **submitted** timesheets, i.e. what people
 *   logged. Draft weeks are excluded (they're still being edited), so every hours
 *   figure is paired with submitted-week *coverage* — a timesheet row is created
 *   lazily, so a missing week means "not started", not zero.
 *
 * The definitions the numbers depend on, stated once:
 *
 * - **Working day** — Mon–Fri. No statutory-holiday calendar and no half-days,
 *   matching `countWorkingDays` in `@/lib/staff/pto-working-days`.
 * - **Employment window** — a day counts for a person only when `joinDate <= day`
 *   (if set) and `day <= terminationDate` (if set). This is what makes available
 *   hours "adjusted for join/termination".
 * - **Available hours** — full-time only: employed working days × 8h. Hourly staff
 *   have no fixed capacity, so they get no denominator and no utilization %; their
 *   project hours still count toward the totals.
 * - **PTO wins.** On an approved-PTO working day a full-timer books 8 PTO hours and
 *   *no* project or bench hours, even if a role covers that day. So project + PTO +
 *   bench equals available hours exactly — except when someone is over-allocated.
 * - **Over-allocation is not clamped.** Two overlapping full-time roles read as 16h
 *   and >100%. The allocations planner deliberately never sums a person's load
 *   across projects, so this is the first surface that shows it; hiding it would
 *   defeat the point.
 * - **Bench day** — a full-time *billable* working day inside the employment window
 *   with no included role and no approved PTO. Streaks run over working days: a
 *   weekend doesn't break one, a PTO day does.
 * - **Which roles count** — `confirmed` always, `tentative` only when the forecast
 *   toggle is on. Line-of-business alignment ignores the toggle by design (it asks
 *   where committed work actually sits), so it reads confirmed roles only.
 */

import {
  HOURS_PER_DAY,
  WORKING_DAYS_PER_WEEK,
} from "@/lib/allocations/allocations-grid";
import {
  LINE_OF_BUSINESS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import {
  type ProjectRoleStatus,
  ROLE_STATUS,
} from "@/lib/projects/project-role-status";
import { countWorkingDays } from "@/lib/staff/pto-working-days";
import type { EmploymentType, Role } from "@/lib/staff/staff-enums";
import type { TimesheetCategory } from "@/lib/timesheets/timesheet-category";
import {
  eachDay,
  getWeekStart,
  isWeekend,
} from "@/lib/timesheets/timesheet-week";

/**
 * The weight a tentative role carries when the forecast toggle is on. Flat 100%
 * today: the schema has no win-probability field, so there is nothing to weight
 * with. Kept as one named constant so probability tiers (High/Medium/Low) can be
 * introduced by making this a lookup, without touching any of the math below.
 */
export const TENTATIVE_WEIGHT = 1;

/** More than this many consecutive bench days is what the Bench card counts. */
export const BENCH_STREAK_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Inputs — the shape `getUtilizationReport` projects into
// ---------------------------------------------------------------------------

/** The inclusive reporting window, as wall-clock `"YYYY-MM-DD"` strings. */
export type UtilizationRange = { start: string; end: string };

/** One person, with their employment facts resolved as of the range end. */
export type UtilizationStaff = {
  id: string;
  name: string;
  joinDate: string | null;
  terminationDate: string | null;
  lineOfBusiness: LineOfBusiness | null;
  role: Role | null;
  employmentType: EmploymentType | null;
  isBillable: boolean;
};

/** One staffed role span overlapping the range. */
export type UtilizationRole = {
  id: string;
  staffId: string;
  projectId: string;
  projectName: string;
  status: ProjectRoleStatus;
  lineOfBusiness: LineOfBusiness;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
};

/** One approved time-off span. The leave *type* is deliberately not carried. */
export type UtilizationPtoRecord = {
  staffId: string;
  startDate: string;
  endDate: string;
};

/** One time entry from a submitted timesheet (`projectId` XOR `category`). */
export type UtilizationEntry = {
  staffId: string;
  date: string;
  projectId: string | null;
  category: TimesheetCategory | null;
  hours: number;
};

/** Whether a person's timesheet for a given week exists and is submitted. */
export type UtilizationWeek = {
  staffId: string;
  weekStartDate: string;
  submitted: boolean;
};

export type UtilizationInputs = {
  staff: UtilizationStaff[];
  roles: UtilizationRole[];
  pto: UtilizationPtoRecord[];
  entries: UtilizationEntry[];
  weeks: UtilizationWeek[];
  /** Earliest confirmed role start per person, over *all* time — the joiner
   *  "days to first placement" metric needs a role that may precede the range. */
  firstRoleStartByStaff: Record<string, string>;
  range: UtilizationRange;
  includeTentative: boolean;
  /**
   * The staff whose confirmed hours the viewer may read. `null` means "all of
   * them" (a `timesheets.edit` holder); otherwise it is the viewer's own id and
   * nothing else. Cohort-level confirmed figures are withheld entirely when this
   * is a subset — a partial sum presented as a total would be a lie.
   */
  confirmedStaffIds: readonly string[] | null;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * One metric carried in both series. `confirmed` (and therefore `variance`) is
 * `null` — never `0` — when the viewer may not read the underlying timesheets, so
 * "no access" and "logged nothing" stay distinguishable all the way to the render.
 */
export type HoursSeries = {
  planned: number;
  confirmed: number | null;
  variance: number | null;
};

function series(planned: number, confirmed: number | null): HoursSeries {
  return {
    planned,
    confirmed,
    variance: confirmed == null ? null : confirmed - planned,
  };
}

export type HeadcountRoleRow = {
  role: Role | null;
  total: number;
  fullTime: number;
  hourly: number;
  joiners: number;
  departures: number;
};

export type HeadcountSummary = {
  total: number;
  fullTime: number;
  hourly: number;
  joiners: number;
  departures: number;
  byRole: HeadcountRoleRow[];
};

export type RoleSummary = {
  activeRoles: number;
  started: number;
  ended: number;
  averageLengthWeeks: number | null;
  averageRolesPerProject: number | null;
  uniqueProjects: number;
  /** Distinct projects with logged time; `null` without full timesheet access. */
  projectsWithLoggedTime: number | null;
};

export type BenchSummary = {
  staffOverThreshold: number;
  averageStreak: number | null;
  maxStreak: number;
  averageBenchDays: number | null;
  maxBenchDays: number;
  averageDaysToFirstPlacement: number | null;
  unplacedJoiners: number;
  /** Logged `UNALLOCATED_BENCH` hours; `null` without full timesheet access. */
  confirmedBenchHours: number | null;
};

export type PtoSummary = {
  totalDays: number;
  averageRecordLength: number | null;
  maxRecordLength: number;
  peopleWithPto: number;
  peopleWithoutPto: number;
  /** Logged `PTO`-category hours; `null` without full timesheet access. */
  confirmedPtoHours: number | null;
};

/** One row of the full-time time split. Shares are fractions of available hours. */
export type UtilizationSplitRow = {
  key: "project" | "pto" | "bench" | "internalAdmin";
  /** `null` for `internalAdmin` — the plan has no equivalent bucket. */
  planned: number | null;
  plannedShare: number | null;
  confirmed: number | null;
  confirmedShare: number | null;
};

export type UtilizationSummary = {
  availableHours: number;
  projectHours: HoursSeries;
  projectHoursFullTime: HoursSeries;
  projectHoursHourly: HoursSeries;
  rows: UtilizationSplitRow[];
  /** Project hours ÷ available hours, full-time only. May exceed 1. */
  utilization: { planned: number | null; confirmed: number | null };
};

export type StaffBreakdownRow = {
  staffId: string;
  name: string;
  role: Role | null;
  lineOfBusiness: LineOfBusiness | null;
  employmentType: EmploymentType | null;
  /** `null` for hourly staff — no fixed capacity, so no denominator. */
  availableHours: number | null;
  plannedProjectHours: number;
  confirmedProjectHours: number | null;
  plannedUtilization: number | null;
  confirmedUtilization: number | null;
  varianceHours: number | null;
  weeksSubmitted: number;
  weeksInRange: number;
  hasConfirmedAccess: boolean;
};

export type LobAlignmentRow = {
  lineOfBusiness: LineOfBusiness;
  plannedDays: number;
  plannedShare: number;
  confirmedHours: number | null;
  confirmedShare: number | null;
};

/** Submitted-week coverage for the cohort — the caveat on every confirmed number. */
export type CoverageSummary = {
  weeksSubmitted: number;
  weeksTotal: number;
  hasFullAccess: boolean;
};

export type UtilizationReport = {
  headcount: HeadcountSummary;
  roles: RoleSummary;
  bench: BenchSummary;
  pto: PtoSummary;
  utilization: UtilizationSummary;
  staffBreakdown: StaffBreakdownRow[];
  lobAlignment: LobAlignmentRow[];
  coverage: CoverageSummary;
};

// ---------------------------------------------------------------------------
// Day-level ledger — the shared engine every card reads from
// ---------------------------------------------------------------------------

/** Whole-day index since the epoch, in UTC so DST can't shift the difference. */
function dayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Inclusive calendar-day distance from `a` to `b` (negative when `b` precedes). */
function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

/** Does the inclusive span `[aStart, aEnd]` intersect `[bStart, bEnd]`? */
function spansOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Is the person on payroll on `day`? Open-ended at either end when unset. */
function isEmployedOn(person: UtilizationStaff, day: string): boolean {
  if (person.joinDate != null && day < person.joinDate) return false;
  if (person.terminationDate != null && day > person.terminationDate)
    return false;
  return true;
}

function isFullTime(person: UtilizationStaff): boolean {
  return person.employmentType === "FULL_TIME";
}

/** Everything the cards need about one person's days in the range. */
type StaffLedger = {
  employedWorkingDays: number;
  employedWeeks: Set<string>;
  availableHours: number;
  plannedProjectHours: number;
  plannedPtoHours: number;
  plannedBenchHours: number;
  ptoDays: number;
  benchDays: number;
  benchStreaks: number[];
  /** Working days attributed to each line of business (confirmed roles only). */
  lobDays: Map<LineOfBusiness, number>;
};

function emptyLedger(): StaffLedger {
  return {
    employedWorkingDays: 0,
    employedWeeks: new Set(),
    availableHours: 0,
    plannedProjectHours: 0,
    plannedPtoHours: 0,
    plannedBenchHours: 0,
    ptoDays: 0,
    benchDays: 0,
    benchStreaks: [],
    lobDays: new Map(),
  };
}

/**
 * Walk one person's working days in the range, folding roles and PTO into the
 * ledger the cards read. Roles are pre-filtered to those the forecast toggle
 * includes; `confirmedRoles` is the unfiltered-by-toggle confirmed subset, used
 * for line-of-business attribution only.
 *
 * `workingDays` is the range's weekday spine, built once by the caller and shared
 * across everyone — re-deriving it per person would re-parse and re-format every
 * date in the window once for each member of the cohort.
 */
function buildStaffLedger(
  person: UtilizationStaff,
  includedRoles: UtilizationRole[],
  confirmedRoles: UtilizationRole[],
  ptoDays: ReadonlySet<string>,
  workingDays: readonly string[],
): StaffLedger {
  const ledger = emptyLedger();
  const fullTime = isFullTime(person);
  const tracksBench = fullTime && person.isBillable;
  let currentStreak = 0;

  const closeStreak = () => {
    if (currentStreak > 0) ledger.benchStreaks.push(currentStreak);
    currentStreak = 0;
  };

  for (const day of workingDays) {
    if (!isEmployedOn(person, day)) {
      closeStreak();
      continue;
    }

    ledger.employedWorkingDays += 1;
    ledger.employedWeeks.add(getWeekStart(day));
    if (fullTime) ledger.availableHours += HOURS_PER_DAY;

    let dayHours = 0;
    for (const role of includedRoles) {
      if (day < role.startDate || day > role.endDate) continue;
      dayHours +=
        role.status === ROLE_STATUS.tentative
          ? role.hoursPerDay * TENTATIVE_WEIGHT
          : role.hoursPerDay;
    }

    // Line of business: the confirmed role the person spends most of the day on
    // wins; otherwise the day sits with their home line of business. PTO days go
    // home too — nobody bills a practice while they're away.
    const onPto = ptoDays.has(day);
    let lob = person.lineOfBusiness;
    if (!onPto) {
      let topHours = 0;
      for (const role of confirmedRoles) {
        if (day < role.startDate || day > role.endDate) continue;
        if (role.hoursPerDay > topHours) {
          topHours = role.hoursPerDay;
          lob = role.lineOfBusiness;
        }
      }
    }
    if (lob != null) {
      ledger.lobDays.set(lob, (ledger.lobDays.get(lob) ?? 0) + 1);
    }

    if (onPto) {
      // PTO wins: no project or bench hours book against a day off.
      ledger.ptoDays += 1;
      if (fullTime) ledger.plannedPtoHours += HOURS_PER_DAY;
      closeStreak();
      continue;
    }

    ledger.plannedProjectHours += dayHours;
    if (fullTime) {
      ledger.plannedBenchHours += Math.max(0, HOURS_PER_DAY - dayHours);
    }

    if (tracksBench && dayHours === 0) {
      ledger.benchDays += 1;
      currentStreak += 1;
    } else {
      closeStreak();
    }
  }

  closeStreak();
  return ledger;
}

/** The working days in `[range]` covered by any of the person's approved PTO. */
function ptoDaysInRange(
  records: UtilizationPtoRecord[],
  range: UtilizationRange,
): Set<string> {
  const days = new Set<string>();
  for (const record of records) {
    const from =
      record.startDate > range.start ? record.startDate : range.start;
    const to = record.endDate < range.end ? record.endDate : range.end;
    for (const day of eachDay(from, to)) {
      if (!isWeekend(day)) days.add(day);
    }
  }
  return days;
}

/** Confirmed hours split into the four buckets a time entry can land in. */
type EntryTotals = {
  project: number;
  pto: number;
  bench: number;
  internalAdmin: number;
};

function emptyEntryTotals(): EntryTotals {
  return { project: 0, pto: 0, bench: 0, internalAdmin: 0 };
}

function addEntry(totals: EntryTotals, entry: UtilizationEntry): void {
  if (entry.projectId != null) {
    totals.project += entry.hours;
    return;
  }
  switch (entry.category) {
    case "PTO":
      totals.pto += entry.hours;
      break;
    case "UNALLOCATED_BENCH":
      totals.bench += entry.hours;
      break;
    case "INTERNAL_ADMIN":
      totals.internalAdmin += entry.hours;
      break;
    default:
      break;
  }
}

function groupBy<T>(
  rows: readonly T[],
  key: (row: T) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const existing = out.get(k);
    if (existing) existing.push(row);
    else out.set(k, [row]);
  }
  return out;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function shareOf(value: number, total: number): number | null {
  return total === 0 ? null : value / total;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/**
 * Fold the read's projection into every card, in one pass over the cohort. The
 * caller has already narrowed `staff` to the line-of-business filter; roles, PTO
 * and entries may still contain rows for people outside it and are matched by id.
 */
export function buildUtilizationReport(
  inputs: UtilizationInputs,
): UtilizationReport {
  const { range, includeTentative } = inputs;
  const cohort = inputs.staff;
  const cohortIds = new Set(cohort.map((p) => p.id));
  const hasFullAccess = inputs.confirmedStaffIds == null;
  const visibleIds =
    inputs.confirmedStaffIds == null ? null : new Set(inputs.confirmedStaffIds);
  const canSeeConfirmed = (staffId: string) =>
    visibleIds == null || visibleIds.has(staffId);

  // The weekday spine, built once and shared by every person's ledger.
  const workingDays = eachDay(range.start, range.end).filter(
    (day) => !isWeekend(day),
  );

  const rolesByStaff = groupBy(
    inputs.roles.filter((r) => cohortIds.has(r.staffId)),
    (r) => r.staffId,
  );
  const ptoByStaff = groupBy(
    inputs.pto.filter((p) => cohortIds.has(p.staffId)),
    (p) => p.staffId,
  );
  const entriesByStaff = groupBy(
    inputs.entries.filter((e) => cohortIds.has(e.staffId)),
    (e) => e.staffId,
  );
  const weeksByStaff = groupBy(
    inputs.weeks.filter((w) => cohortIds.has(w.staffId)),
    (w) => w.staffId,
  );

  const ledgers = new Map<string, StaffLedger>();
  const entryTotals = new Map<string, EntryTotals>();
  const ptoDayCounts = new Map<string, number>();

  for (const person of cohort) {
    const all = rolesByStaff.get(person.id) ?? [];
    const confirmedRoles = all.filter(
      (r) => r.status === ROLE_STATUS.confirmed,
    );
    const includedRoles = includeTentative ? all : confirmedRoles;
    const ptoDays = ptoDaysInRange(ptoByStaff.get(person.id) ?? [], range);
    const ledger = buildStaffLedger(
      person,
      includedRoles,
      confirmedRoles,
      ptoDays,
      workingDays,
    );
    ledgers.set(person.id, ledger);
    ptoDayCounts.set(person.id, ledger.ptoDays);

    const totals = emptyEntryTotals();
    for (const entry of entriesByStaff.get(person.id) ?? []) {
      addEntry(totals, entry);
    }
    entryTotals.set(person.id, totals);
  }

  return {
    headcount: buildHeadcount(cohort, range),
    roles: buildRoleSummary(
      cohort,
      rolesByStaff,
      entriesByStaff,
      range,
      includeTentative,
      hasFullAccess,
    ),
    bench: buildBenchSummary(
      cohort,
      ledgers,
      entryTotals,
      inputs.firstRoleStartByStaff,
      range,
      hasFullAccess,
    ),
    pto: buildPtoSummary(
      cohort,
      ptoByStaff,
      ptoDayCounts,
      entryTotals,
      range,
      hasFullAccess,
    ),
    utilization: buildUtilizationSummary(
      cohort,
      ledgers,
      entryTotals,
      hasFullAccess,
    ),
    staffBreakdown: buildStaffBreakdown(
      cohort,
      ledgers,
      entryTotals,
      weeksByStaff,
      canSeeConfirmed,
    ),
    lobAlignment: buildLobAlignment(
      cohort,
      ledgers,
      entriesByStaff,
      rolesByStaff,
      hasFullAccess,
    ),
    coverage: buildCoverage(cohort, ledgers, weeksByStaff, hasFullAccess),
  };
}

/** Headcount, FT/hourly split, joiners/departures — overall and per discipline. */
export function buildHeadcount(
  cohort: UtilizationStaff[],
  range: UtilizationRange,
): HeadcountSummary {
  const joined = (p: UtilizationStaff) =>
    p.joinDate != null && p.joinDate >= range.start && p.joinDate <= range.end;
  const departed = (p: UtilizationStaff) =>
    p.terminationDate != null &&
    p.terminationDate >= range.start &&
    p.terminationDate <= range.end;

  const tally = (people: UtilizationStaff[]) => ({
    total: people.length,
    fullTime: people.filter(isFullTime).length,
    hourly: people.filter((p) => p.employmentType === "HOURLY").length,
    joiners: people.filter(joined).length,
    departures: people.filter(departed).length,
  });

  const byRoleMap = groupBy(cohort, (p) => p.role ?? "");
  const byRole: HeadcountRoleRow[] = [...byRoleMap.entries()]
    .map(([role, people]) => ({
      role: (role === "" ? null : (role as Role)) as Role | null,
      ...tally(people),
    }))
    .sort((a, b) => b.total - a.total);

  return { ...tally(cohort), byRole };
}

/** Active roles, churn, average length, roles per project, project counts. */
export function buildRoleSummary(
  cohort: UtilizationStaff[],
  rolesByStaff: Map<string, UtilizationRole[]>,
  entriesByStaff: Map<string, UtilizationEntry[]>,
  range: UtilizationRange,
  includeTentative: boolean,
  hasFullAccess: boolean,
): RoleSummary {
  const roles: UtilizationRole[] = [];
  for (const person of cohort) {
    for (const role of rolesByStaff.get(person.id) ?? []) {
      if (!includeTentative && role.status !== ROLE_STATUS.confirmed) continue;
      if (!spansOverlap(role.startDate, role.endDate, range.start, range.end))
        continue;
      roles.push(role);
    }
  }

  const lengths = roles.map(
    (r) => countWorkingDays(r.startDate, r.endDate) / WORKING_DAYS_PER_WEEK,
  );
  const projectIds = new Set(roles.map((r) => r.projectId));

  const loggedProjects = new Set<string>();
  for (const person of cohort) {
    for (const entry of entriesByStaff.get(person.id) ?? []) {
      if (entry.projectId != null) loggedProjects.add(entry.projectId);
    }
  }

  return {
    activeRoles: roles.length,
    started: roles.filter(
      (r) => r.startDate >= range.start && r.startDate <= range.end,
    ).length,
    ended: roles.filter(
      (r) => r.endDate >= range.start && r.endDate <= range.end,
    ).length,
    averageLengthWeeks: average(lengths),
    averageRolesPerProject:
      projectIds.size === 0 ? null : roles.length / projectIds.size,
    uniqueProjects: projectIds.size,
    projectsWithLoggedTime: hasFullAccess ? loggedProjects.size : null,
  };
}

/** Bench streaks and totals for full-time billable staff, plus joiner placement. */
export function buildBenchSummary(
  cohort: UtilizationStaff[],
  ledgers: Map<string, StaffLedger>,
  entryTotals: Map<string, EntryTotals>,
  firstRoleStartByStaff: Record<string, string>,
  range: UtilizationRange,
  hasFullAccess: boolean,
): BenchSummary {
  const tracked = cohort.filter((p) => isFullTime(p) && p.isBillable);

  const streaks: number[] = [];
  const benchDays: number[] = [];
  let overThreshold = 0;
  for (const person of tracked) {
    const ledger = ledgers.get(person.id);
    if (!ledger) continue;
    benchDays.push(ledger.benchDays);
    streaks.push(...ledger.benchStreaks);
    const longest = Math.max(0, ...ledger.benchStreaks);
    if (longest > BENCH_STREAK_THRESHOLD) overThreshold += 1;
  }

  const joiners = tracked.filter(
    (p) =>
      p.joinDate != null &&
      p.joinDate >= range.start &&
      p.joinDate <= range.end,
  );
  const placementGaps: number[] = [];
  let unplaced = 0;
  for (const person of joiners) {
    const firstStart = firstRoleStartByStaff[person.id];
    if (firstStart == null || person.joinDate == null) {
      unplaced += 1;
      continue;
    }
    placementGaps.push(Math.max(0, daysBetween(person.joinDate, firstStart)));
  }

  let confirmedBench = 0;
  for (const person of cohort) {
    confirmedBench += entryTotals.get(person.id)?.bench ?? 0;
  }

  return {
    staffOverThreshold: overThreshold,
    averageStreak: average(streaks),
    maxStreak: Math.max(0, ...streaks),
    averageBenchDays: average(benchDays),
    maxBenchDays: Math.max(0, ...benchDays),
    averageDaysToFirstPlacement: average(placementGaps),
    unplacedJoiners: unplaced,
    confirmedBenchHours: hasFullAccess ? confirmedBench : null,
  };
}

/**
 * PTO volume and shape. `totalDays` is clipped to the range and the employment
 * window (it answers "how much leave landed in this period"), while the average
 * and max record lengths measure the **whole** record — a two-week holiday
 * straddling the range edge is still a two-week holiday.
 */
export function buildPtoSummary(
  cohort: UtilizationStaff[],
  ptoByStaff: Map<string, UtilizationPtoRecord[]>,
  ptoDayCounts: Map<string, number>,
  entryTotals: Map<string, EntryTotals>,
  range: UtilizationRange,
  hasFullAccess: boolean,
): PtoSummary {
  const recordLengths: number[] = [];
  let totalDays = 0;
  let peopleWithPto = 0;
  let confirmedPto = 0;

  for (const person of cohort) {
    const days = ptoDayCounts.get(person.id) ?? 0;
    totalDays += days;
    if (days > 0) peopleWithPto += 1;

    for (const record of ptoByStaff.get(person.id) ?? []) {
      if (
        !spansOverlap(record.startDate, record.endDate, range.start, range.end)
      )
        continue;
      recordLengths.push(countWorkingDays(record.startDate, record.endDate));
    }

    confirmedPto += entryTotals.get(person.id)?.pto ?? 0;
  }

  return {
    totalDays,
    averageRecordLength: average(recordLengths),
    maxRecordLength: Math.max(0, ...recordLengths),
    peopleWithPto,
    peopleWithoutPto: cohort.length - peopleWithPto,
    confirmedPtoHours: hasFullAccess ? confirmedPto : null,
  };
}

/** The headline split of full-time time into project / PTO / bench, both series. */
export function buildUtilizationSummary(
  cohort: UtilizationStaff[],
  ledgers: Map<string, StaffLedger>,
  entryTotals: Map<string, EntryTotals>,
  hasFullAccess: boolean,
): UtilizationSummary {
  let availableHours = 0;
  let plannedProjectFt = 0;
  let plannedProjectHourly = 0;
  let plannedPto = 0;
  let plannedBench = 0;
  let confirmedProjectFt = 0;
  let confirmedProjectHourly = 0;
  let confirmedPto = 0;
  let confirmedBench = 0;
  let confirmedAdmin = 0;

  for (const person of cohort) {
    const ledger = ledgers.get(person.id);
    const totals = entryTotals.get(person.id) ?? emptyEntryTotals();
    if (!ledger) continue;

    if (isFullTime(person)) {
      availableHours += ledger.availableHours;
      plannedProjectFt += ledger.plannedProjectHours;
      plannedPto += ledger.plannedPtoHours;
      plannedBench += ledger.plannedBenchHours;
      confirmedProjectFt += totals.project;
    } else {
      plannedProjectHourly += ledger.plannedProjectHours;
      confirmedProjectHourly += totals.project;
    }
    confirmedPto += totals.pto;
    confirmedBench += totals.bench;
    confirmedAdmin += totals.internalAdmin;
  }

  const gate = (value: number) => (hasFullAccess ? value : null);
  const share = (value: number | null) =>
    value == null ? null : shareOf(value, availableHours);

  const rows: UtilizationSplitRow[] = [
    {
      key: "project",
      planned: plannedProjectFt,
      plannedShare: shareOf(plannedProjectFt, availableHours),
      confirmed: gate(confirmedProjectFt),
      confirmedShare: share(gate(confirmedProjectFt)),
    },
    {
      key: "pto",
      planned: plannedPto,
      plannedShare: shareOf(plannedPto, availableHours),
      confirmed: gate(confirmedPto),
      confirmedShare: share(gate(confirmedPto)),
    },
    {
      key: "bench",
      planned: plannedBench,
      plannedShare: shareOf(plannedBench, availableHours),
      confirmed: gate(confirmedBench),
      confirmedShare: share(gate(confirmedBench)),
    },
    {
      key: "internalAdmin",
      planned: null,
      plannedShare: null,
      confirmed: gate(confirmedAdmin),
      confirmedShare: share(gate(confirmedAdmin)),
    },
  ];

  const plannedProjectTotal = plannedProjectFt + plannedProjectHourly;
  const confirmedProjectTotal = confirmedProjectFt + confirmedProjectHourly;

  return {
    availableHours,
    projectHours: series(plannedProjectTotal, gate(confirmedProjectTotal)),
    projectHoursFullTime: series(plannedProjectFt, gate(confirmedProjectFt)),
    projectHoursHourly: series(
      plannedProjectHourly,
      gate(confirmedProjectHourly),
    ),
    rows,
    utilization: {
      planned: shareOf(plannedProjectFt, availableHours),
      confirmed: share(gate(confirmedProjectFt)),
    },
  };
}

/** One row per person: capacity, both hour series, utilization, and coverage. */
export function buildStaffBreakdown(
  cohort: UtilizationStaff[],
  ledgers: Map<string, StaffLedger>,
  entryTotals: Map<string, EntryTotals>,
  weeksByStaff: Map<string, UtilizationWeek[]>,
  canSeeConfirmed: (staffId: string) => boolean,
): StaffBreakdownRow[] {
  return cohort
    .map((person) => {
      const ledger = ledgers.get(person.id) ?? emptyLedger();
      const visible = canSeeConfirmed(person.id);
      const confirmedHours = visible
        ? (entryTotals.get(person.id)?.project ?? 0)
        : null;
      const availableHours = isFullTime(person) ? ledger.availableHours : null;

      const weeks = (weeksByStaff.get(person.id) ?? []).filter((w) =>
        ledger.employedWeeks.has(w.weekStartDate),
      );

      return {
        staffId: person.id,
        name: person.name,
        role: person.role,
        lineOfBusiness: person.lineOfBusiness,
        employmentType: person.employmentType,
        availableHours,
        plannedProjectHours: ledger.plannedProjectHours,
        confirmedProjectHours: confirmedHours,
        plannedUtilization:
          availableHours == null
            ? null
            : shareOf(ledger.plannedProjectHours, availableHours),
        confirmedUtilization:
          availableHours == null || confirmedHours == null
            ? null
            : shareOf(confirmedHours, availableHours),
        varianceHours:
          confirmedHours == null
            ? null
            : confirmedHours - ledger.plannedProjectHours,
        weeksSubmitted: visible ? weeks.filter((w) => w.submitted).length : 0,
        weeksInRange: ledger.employedWeeks.size,
        hasConfirmedAccess: visible,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Where the cohort's time sits by line of business. Planned counts working days
 * (each day lands in exactly one line of business, so the shares total 100%).
 * Confirmed counts logged hours, attributed to the person's own confirmed role on
 * that project for that date and falling back to their home line of business when
 * they logged against a project they were never staffed to — `projects` has no
 * line of business of its own, only its roles do.
 */
export function buildLobAlignment(
  cohort: UtilizationStaff[],
  ledgers: Map<string, StaffLedger>,
  entriesByStaff: Map<string, UtilizationEntry[]>,
  rolesByStaff: Map<string, UtilizationRole[]>,
  hasFullAccess: boolean,
): LobAlignmentRow[] {
  const plannedDays = new Map<LineOfBusiness, number>();
  const confirmedHours = new Map<LineOfBusiness, number>();
  let plannedTotal = 0;
  let confirmedTotal = 0;

  for (const person of cohort) {
    const ledger = ledgers.get(person.id);
    if (ledger) {
      for (const [lob, days] of ledger.lobDays) {
        plannedDays.set(lob, (plannedDays.get(lob) ?? 0) + days);
        plannedTotal += days;
      }
    }

    const confirmedRoles = (rolesByStaff.get(person.id) ?? []).filter(
      (r) => r.status === ROLE_STATUS.confirmed,
    );
    for (const entry of entriesByStaff.get(person.id) ?? []) {
      if (entry.projectId == null) continue;
      const match = confirmedRoles.find(
        (r) =>
          r.projectId === entry.projectId &&
          entry.date >= r.startDate &&
          entry.date <= r.endDate,
      );
      const lob = match?.lineOfBusiness ?? person.lineOfBusiness;
      if (lob == null) continue;
      confirmedHours.set(lob, (confirmedHours.get(lob) ?? 0) + entry.hours);
      confirmedTotal += entry.hours;
    }
  }

  return LINE_OF_BUSINESS.map((lob) => {
    const days = plannedDays.get(lob) ?? 0;
    const hours = confirmedHours.get(lob) ?? 0;
    return {
      lineOfBusiness: lob,
      plannedDays: days,
      plannedShare: plannedTotal === 0 ? 0 : days / plannedTotal,
      confirmedHours: hasFullAccess ? hours : null,
      confirmedShare: !hasFullAccess
        ? null
        : confirmedTotal === 0
          ? 0
          : hours / confirmedTotal,
    };
  }).filter((row) => row.plannedDays > 0 || (row.confirmedHours ?? 0) > 0);
}

/** How much of the cohort's in-range time is actually backed by submitted weeks. */
export function buildCoverage(
  cohort: UtilizationStaff[],
  ledgers: Map<string, StaffLedger>,
  weeksByStaff: Map<string, UtilizationWeek[]>,
  hasFullAccess: boolean,
): CoverageSummary {
  let submitted = 0;
  let total = 0;
  for (const person of cohort) {
    const ledger = ledgers.get(person.id);
    if (!ledger) continue;
    total += ledger.employedWeeks.size;
    for (const week of weeksByStaff.get(person.id) ?? []) {
      if (week.submitted && ledger.employedWeeks.has(week.weekStartDate))
        submitted += 1;
    }
  }
  return { weeksSubmitted: submitted, weeksTotal: total, hasFullAccess };
}
