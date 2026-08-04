/**
 * Pure math for the utilization report. A client-importable module (no `db`, no
 * React) so the read stays a projection and every definition below is testable in
 * isolation. See docs/domains/allocations.md and docs/domains/timesheets.md.
 *
 * Every hours-bearing figure is computed in **two series**, and the reader picks
 * one to look at with the report's basis toggle:
 *
 * - **Planned** — from `project_roles`, i.e. what we staffed. `hoursPerDay` over the
 *   working days a role covers, the same basis `roleBillableHours` uses in
 *   `@/lib/projects/project-margin`. The default, and the only series available to
 *   a viewer who may not read other people's timesheets.
 * - **Logged** — from `time_entries` on **submitted** timesheets, i.e. what people
 *   actually recorded. Draft weeks are excluded (they're still being edited), so
 *   every logged figure is paired with submitted-week *coverage* — a timesheet row
 *   is created lazily, so a missing week means "not started", not zero.
 *
 * Both series are always computed, never summed, and never shown side by side: the
 * cards render one and use the other to flag a figure that {@link deviates} from
 * plan. That is where the comparison earns its keep, instead of doubling every
 * column to pay for it.
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
 *   project hours still count toward the totals and carry their own share.
 * - **PTO and bench are full-time measures.** Planned leave books 8h against a
 *   full-timer's capacity; an hourly person has no capacity to book it against, so
 *   they contribute no planned PTO and no bench. Their *logged* PTO still lands
 *   somewhere in the line-of-business attribution — it happened — but it is not
 *   counted in the PTO card or the utilization split.
 * - **PTO wins.** On an approved-PTO working day a full-timer books 8 PTO hours and
 *   *no* project or bench hours, even if a role covers that day. So project + PTO +
 *   bench equals available hours exactly — except when someone is over-allocated.
 * - **Over-allocation is not clamped.** Two overlapping full-time roles read as 16h
 *   and >100%. The allocations planner deliberately never sums a person's load
 *   across projects, so this is the first surface that shows it; hiding it would
 *   defeat the point.
 * - **Bench day** — a full-time *billable* working day inside the employment window
 *   with no role and no approved PTO. Streaks run over working days: a weekend
 *   doesn't break one, a PTO day does.
 * - **Which roles count** — `confirmed` only. A tentative role is a forecast, not an
 *   allocation, and there is no win probability to weight one by, so counting it at
 *   full weight only made every figure softer than it looked.
 * - **Internal admin is excluded.** Overhead time belongs to no practice and to
 *   neither the project nor the bench series, so it is dropped rather than given a
 *   bucket that has no planned counterpart.
 */

import {
  HOURS_PER_DAY,
  WORKING_DAYS_PER_WEEK,
} from "@/lib/allocations/allocations-grid";
import {
  LINE_OF_BUSINESS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import type { ReportRange } from "@/lib/reporting/report-range";
import { countWorkingDays } from "@/lib/staff/pto-working-days";
import type { EmploymentType, Role } from "@/lib/staff/staff-enums";
import type { TimesheetCategory } from "@/lib/timesheets/timesheet-category";
import {
  eachDay,
  getWeekStart,
  isWeekend,
} from "@/lib/timesheets/timesheet-week";

/** Which series the report is currently showing. Planned is the default. */
export type ReportBasis = "planned" | "logged";

/** More than this many consecutive bench days is what the Bench card counts. */
export const BENCH_STREAK_THRESHOLD = 5;

/**
 * How far a logged figure has to sit from its planned counterpart, in relative
 * terms, before the report flags it. 20% is roughly one day a week.
 */
export const DEVIATION_THRESHOLD = 0.2;

/**
 * The absolute gap a deviation also has to clear — one working day. Without it a
 * 4h plan against 6h logged reads as a 50% miss, which is noise rather than news.
 */
export const DEVIATION_FLOOR_HOURS = HOURS_PER_DAY;

// ---------------------------------------------------------------------------
// Inputs — the shape `getUtilizationReport` projects into
// ---------------------------------------------------------------------------

/**
 * The inclusive reporting window, as wall-clock `"YYYY-MM-DD"` strings.
 *
 * An alias for the shared {@link ReportRange} rather than a second declaration:
 * the window is parsed by `report-range.ts`, which the finance report shares, so
 * two structurally-identical types would drift into two ideas of a window. Kept
 * under this name because it reads better at the ~30 call sites in this module.
 */
export type UtilizationRange = ReportRange;

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

/** One confirmed, staffed role span overlapping the range. */
export type UtilizationRole = {
  id: string;
  staffId: string;
  projectId: string;
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
  /**
   * Whether the viewer may read the cohort's logged hours (`timesheets.edit`).
   * When false every logged figure is `null` — never `0` — so "no access" and
   * "logged nothing" stay distinguishable all the way to the render, and the
   * report's basis toggle offers Planned only.
   */
  canViewLogged: boolean;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * One metric carried in both series. `confirmed` (and therefore `variance`) is
 * `null` when the viewer may not read the underlying timesheets.
 */
export type HoursSeries = {
  planned: number;
  confirmed: number | null;
  variance: number | null;
};

/** A {@link HoursSeries} plus each series' share of whatever denominator it has. */
export type HoursMetric = {
  hours: HoursSeries;
  plannedShare: number | null;
  confirmedShare: number | null;
};

function series(planned: number, confirmed: number | null): HoursSeries {
  return {
    planned,
    confirmed,
    variance: confirmed == null ? null : confirmed - planned,
  };
}

function metric(
  planned: number,
  confirmed: number | null,
  denominator: number | null,
): HoursMetric {
  const share = (value: number | null) =>
    value == null || denominator == null || denominator === 0
      ? null
      : value / denominator;
  return {
    hours: series(planned, confirmed),
    plannedShare: share(planned),
    confirmedShare: share(confirmed),
  };
}

/** Pick the value for the basis being displayed. */
export function pickBasis<T>(basis: ReportBasis, planned: T, logged: T): T {
  return basis === "planned" ? planned : logged;
}

/** The figure a {@link HoursSeries} shows on the given basis. */
export function hoursFor(
  value: HoursSeries,
  basis: ReportBasis,
): number | null {
  return pickBasis(basis, value.planned, value.confirmed);
}

/** The share a {@link HoursMetric} shows on the given basis. */
export function shareFor(
  value: HoursMetric,
  basis: ReportBasis,
): number | null {
  return pickBasis(basis, value.plannedShare, value.confirmedShare);
}

/**
 * How far the logged figure sits from the planned one, as a signed fraction of
 * plan. `null` when there are no logged hours to compare or nothing was planned —
 * a series with no plan has nothing to deviate from.
 */
export function hoursDeviation(value: HoursSeries): number | null {
  if (value.confirmed == null || value.planned <= 0) return null;
  return (value.confirmed - value.planned) / value.planned;
}

/**
 * Whether a logged figure is far enough from plan to be worth flagging. Both
 * gates must clear: {@link DEVIATION_THRESHOLD} in relative terms *and*
 * {@link DEVIATION_FLOOR_HOURS} in absolute ones.
 */
export function deviates(value: HoursSeries): boolean {
  const deviation = hoursDeviation(value);
  if (deviation == null || value.variance == null) return false;
  if (Math.abs(value.variance) < DEVIATION_FLOOR_HOURS) return false;
  return Math.abs(deviation) >= DEVIATION_THRESHOLD;
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
  /** Distinct projects staffed in the window. */
  uniqueProjects: number;
  /** Distinct projects with logged time; `null` without timesheet access. */
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
  /** Unstaffed full-time capacity, against logged `UNALLOCATED_BENCH` hours. */
  benchHours: HoursSeries;
};

export type PtoSummary = {
  totalDays: number;
  averageRecordLength: number | null;
  maxRecordLength: number;
  peopleWithPto: number;
  peopleWithoutPto: number;
  /** Approved leave as capacity, against logged `PTO`-category hours. */
  ptoHours: HoursSeries;
};

export type UtilizationSummary = {
  availableHours: number;
  /**
   * The full-time split, each as a share of available hours. `fullTimeProject`'s
   * share **is** the utilization rate, and may exceed 1 — see the module header
   * on over-allocation.
   */
  fullTimeProject: HoursMetric;
  pto: HoursMetric;
  bench: HoursMetric;
  /** Project hours across the whole cohort, full-time and hourly together. */
  projectHours: HoursSeries;
  projectHoursHourly: HoursSeries;
  /** Hourly staff's share of all project hours — the part-time contribution. */
  hourlyProjectShare: { planned: number | null; confirmed: number | null };
};

export type StaffBreakdownRow = {
  staffId: string;
  name: string;
  role: Role | null;
  lineOfBusiness: LineOfBusiness | null;
  employmentType: EmploymentType | null;
  /** `null` for hourly staff — no fixed capacity, so no denominator. */
  availableHours: number | null;
  project: HoursMetric;
  /** `null` for non-full-time staff: PTO is a full-time measure. */
  pto: HoursMetric | null;
  /** `null` for non-full-time staff: bench is a full-time measure. */
  bench: HoursMetric | null;
};

/** Hours per line of business, with every practice present so shares line up. */
export type LobHours = Record<LineOfBusiness, number>;

export type LobAlignmentRow = {
  staffId: string;
  name: string;
  role: Role | null;
  lineOfBusiness: LineOfBusiness | null;
  employmentType: EmploymentType | null;
  planned: LobHours;
  /** `null` without timesheet access — withheld, not zero. */
  logged: LobHours | null;
  plannedTotal: number;
  loggedTotal: number | null;
};

/** Submitted-week coverage for the cohort — the caveat on every logged number. */
export type CoverageSummary = {
  weeksSubmitted: number;
  weeksTotal: number;
  canViewLogged: boolean;
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

/** A zeroed hours-per-practice record — every line of business always present. */
function emptyLobHours(): LobHours {
  const out = {} as LobHours;
  for (const lob of LINE_OF_BUSINESS) out[lob] = 0;
  return out;
}

/** Book `hours` against a practice; a person with no home practice is skipped. */
function addLob(
  target: LobHours,
  lob: LineOfBusiness | null,
  hours: number,
): void {
  if (lob == null || hours === 0) return;
  target[lob] += hours;
}

function sumLobHours(hours: LobHours): number {
  return LINE_OF_BUSINESS.reduce((total, lob) => total + hours[lob], 0);
}

/** The role covering `day` that the person spends most of it on, if any. */
function topRoleOn(
  roles: readonly UtilizationRole[],
  day: string,
): UtilizationRole | null {
  let top: UtilizationRole | null = null;
  for (const role of roles) {
    if (day < role.startDate || day > role.endDate) continue;
    if (top == null || role.hoursPerDay > top.hoursPerDay) top = role;
  }
  return top;
}

/** Everything the cards need about one person's planned days in the range. */
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
  /** Planned hours attributed to each line of business. */
  lobHours: LobHours;
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
    lobHours: emptyLobHours(),
  };
}

/**
 * Walk one person's working days in the range, folding roles and PTO into the
 * ledger the cards read.
 *
 * `workingDays` is the range's weekday spine, built once by the caller and shared
 * across everyone — re-deriving it per person would re-parse and re-format every
 * date in the window once for each member of the cohort.
 */
function buildStaffLedger(
  person: UtilizationStaff,
  roles: UtilizationRole[],
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

    if (ptoDays.has(day)) {
      // PTO wins: no project or bench hours book against a day off. Leave taken
      // while staffed on a project sits with that project's practice — the
      // client is still carrying the cost of the person being away.
      ledger.ptoDays += 1;
      if (fullTime) {
        ledger.plannedPtoHours += HOURS_PER_DAY;
        const covering = topRoleOn(roles, day);
        addLob(
          ledger.lobHours,
          covering?.lineOfBusiness ?? person.lineOfBusiness,
          HOURS_PER_DAY,
        );
      }
      closeStreak();
      continue;
    }

    let dayHours = 0;
    for (const role of roles) {
      if (day < role.startDate || day > role.endDate) continue;
      dayHours += role.hoursPerDay;
      addLob(ledger.lobHours, role.lineOfBusiness, role.hoursPerDay);
    }
    ledger.plannedProjectHours += dayHours;

    if (fullTime) {
      // Whatever the day wasn't staffed for is bench, and bench sits with the
      // person's own practice — nobody else is carrying that time.
      const bench = Math.max(0, HOURS_PER_DAY - dayHours);
      ledger.plannedBenchHours += bench;
      addLob(ledger.lobHours, person.lineOfBusiness, bench);
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

/** One person's logged hours, bucketed and attributed to practices. */
type LoggedTotals = {
  project: number;
  pto: number;
  bench: number;
  lobHours: LobHours;
};

function emptyLoggedTotals(): LoggedTotals {
  return { project: 0, pto: 0, bench: 0, lobHours: emptyLobHours() };
}

/**
 * Fold one person's submitted time entries. Practice attribution mirrors the
 * planned side: project hours go to the role they were staffed to on that project
 * for that date, leave logged while staffed goes to that project's practice, and
 * bench time — plus anything logged against a project they were never staffed to
 * — falls back to their own practice. `projects` carries no line of business of
 * its own (ADR 0033), only its roles do, which is what makes that fallback
 * necessary. Internal admin is dropped entirely.
 */
function buildLoggedTotals(
  person: UtilizationStaff,
  roles: readonly UtilizationRole[],
  entries: readonly UtilizationEntry[],
): LoggedTotals {
  const totals = emptyLoggedTotals();

  for (const entry of entries) {
    if (entry.projectId != null) {
      totals.project += entry.hours;
      const staffed = roles.find(
        (role) =>
          role.projectId === entry.projectId &&
          entry.date >= role.startDate &&
          entry.date <= role.endDate,
      );
      addLob(
        totals.lobHours,
        staffed?.lineOfBusiness ?? person.lineOfBusiness,
        entry.hours,
      );
      continue;
    }

    switch (entry.category) {
      case "PTO": {
        totals.pto += entry.hours;
        const covering = topRoleOn(roles, entry.date);
        addLob(
          totals.lobHours,
          covering?.lineOfBusiness ?? person.lineOfBusiness,
          entry.hours,
        );
        break;
      }
      case "UNALLOCATED_BENCH":
        totals.bench += entry.hours;
        addLob(totals.lobHours, person.lineOfBusiness, entry.hours);
        break;
      default:
        // INTERNAL_ADMIN (and any future overhead category) is out of scope by
        // definition — it belongs to no practice and has no planned counterpart.
        break;
    }
  }

  return totals;
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
  const { range, canViewLogged } = inputs;
  const cohort = inputs.staff;
  const cohortIds = new Set(cohort.map((p) => p.id));

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
  const loggedTotals = new Map<string, LoggedTotals>();

  for (const person of cohort) {
    const roles = rolesByStaff.get(person.id) ?? [];
    const ptoDays = ptoDaysInRange(ptoByStaff.get(person.id) ?? [], range);
    ledgers.set(
      person.id,
      buildStaffLedger(person, roles, ptoDays, workingDays),
    );
    // Without access there are no entries to fold, and every logged figure
    // below resolves to `null` rather than to a total built from nothing.
    if (canViewLogged) {
      loggedTotals.set(
        person.id,
        buildLoggedTotals(person, roles, entriesByStaff.get(person.id) ?? []),
      );
    }
  }

  return {
    headcount: buildHeadcount(cohort, range),
    roles: buildRoleSummary(
      cohort,
      rolesByStaff,
      entriesByStaff,
      range,
      canViewLogged,
    ),
    bench: buildBenchSummary(
      cohort,
      ledgers,
      loggedTotals,
      inputs.firstRoleStartByStaff,
      range,
      canViewLogged,
    ),
    pto: buildPtoSummary(
      cohort,
      ptoByStaff,
      ledgers,
      loggedTotals,
      range,
      canViewLogged,
    ),
    utilization: buildUtilizationSummary(
      cohort,
      ledgers,
      loggedTotals,
      canViewLogged,
    ),
    staffBreakdown: buildStaffBreakdown(
      cohort,
      ledgers,
      loggedTotals,
      canViewLogged,
    ),
    lobAlignment: buildLobAlignment(
      cohort,
      ledgers,
      loggedTotals,
      canViewLogged,
    ),
    coverage: buildCoverage(cohort, ledgers, weeksByStaff, canViewLogged),
  };
}

/** Headcount, full-time/hourly split, joiners/departures — overall and per role. */
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
  canViewLogged: boolean,
): RoleSummary {
  const roles: UtilizationRole[] = [];
  for (const person of cohort) {
    for (const role of rolesByStaff.get(person.id) ?? []) {
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
    projectsWithLoggedTime: canViewLogged ? loggedProjects.size : null,
  };
}

/** Bench streaks and totals for full-time billable staff, plus joiner placement. */
export function buildBenchSummary(
  cohort: UtilizationStaff[],
  ledgers: Map<string, StaffLedger>,
  loggedTotals: Map<string, LoggedTotals>,
  firstRoleStartByStaff: Record<string, string>,
  range: UtilizationRange,
  canViewLogged: boolean,
): BenchSummary {
  const tracked = cohort.filter((p) => isFullTime(p) && p.isBillable);

  const streaks: number[] = [];
  const benchDays: number[] = [];
  let overThreshold = 0;
  let plannedBench = 0;
  let loggedBench = 0;
  for (const person of tracked) {
    const ledger = ledgers.get(person.id);
    if (!ledger) continue;
    benchDays.push(ledger.benchDays);
    streaks.push(...ledger.benchStreaks);
    plannedBench += ledger.plannedBenchHours;
    loggedBench += loggedTotals.get(person.id)?.bench ?? 0;
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

  return {
    staffOverThreshold: overThreshold,
    averageStreak: average(streaks),
    maxStreak: Math.max(0, ...streaks),
    averageBenchDays: average(benchDays),
    maxBenchDays: Math.max(0, ...benchDays),
    averageDaysToFirstPlacement: average(placementGaps),
    unplacedJoiners: unplaced,
    benchHours: series(plannedBench, canViewLogged ? loggedBench : null),
  };
}

/**
 * PTO volume and shape, for **full-time staff only** — planned leave books
 * against a fixed working week, and an hourly person has none to book against.
 *
 * `totalDays` is clipped to the range and the employment window (it answers "how
 * much leave landed in this period"), while the average and max record lengths
 * measure the **whole** record — a two-week holiday straddling the range edge is
 * still a two-week holiday.
 */
export function buildPtoSummary(
  cohort: UtilizationStaff[],
  ptoByStaff: Map<string, UtilizationPtoRecord[]>,
  ledgers: Map<string, StaffLedger>,
  loggedTotals: Map<string, LoggedTotals>,
  range: UtilizationRange,
  canViewLogged: boolean,
): PtoSummary {
  const tracked = cohort.filter(isFullTime);
  const recordLengths: number[] = [];
  let totalDays = 0;
  let peopleWithPto = 0;
  let plannedPto = 0;
  let loggedPto = 0;

  for (const person of tracked) {
    const days = ledgers.get(person.id)?.ptoDays ?? 0;
    totalDays += days;
    if (days > 0) peopleWithPto += 1;

    for (const record of ptoByStaff.get(person.id) ?? []) {
      if (
        !spansOverlap(record.startDate, record.endDate, range.start, range.end)
      )
        continue;
      recordLengths.push(countWorkingDays(record.startDate, record.endDate));
    }

    plannedPto += ledgers.get(person.id)?.plannedPtoHours ?? 0;
    loggedPto += loggedTotals.get(person.id)?.pto ?? 0;
  }

  return {
    totalDays,
    averageRecordLength: average(recordLengths),
    maxRecordLength: Math.max(0, ...recordLengths),
    peopleWithPto,
    peopleWithoutPto: tracked.length - peopleWithPto,
    ptoHours: series(plannedPto, canViewLogged ? loggedPto : null),
  };
}

/**
 * The headline split of full-time time into project / PTO / bench, plus the
 * part-time contribution alongside it. Project + PTO + bench reconciles to
 * available hours, so the total is left implicit rather than reported.
 *
 * Every row is **full-time only** on both sides of the comparison: the plan books
 * capacity a full-timer has and an hourly person doesn't, so counting hourly
 * people's logged PTO or bench against a full-time denominator would compare two
 * different populations. Their project hours are reported separately, as a share
 * of all project hours.
 */
export function buildUtilizationSummary(
  cohort: UtilizationStaff[],
  ledgers: Map<string, StaffLedger>,
  loggedTotals: Map<string, LoggedTotals>,
  canViewLogged: boolean,
): UtilizationSummary {
  let availableHours = 0;
  let plannedProjectFt = 0;
  let plannedProjectHourly = 0;
  let plannedPto = 0;
  let plannedBench = 0;
  let loggedProjectFt = 0;
  let loggedProjectHourly = 0;
  let loggedPto = 0;
  let loggedBench = 0;

  for (const person of cohort) {
    const ledger = ledgers.get(person.id);
    if (!ledger) continue;
    const logged = loggedTotals.get(person.id) ?? emptyLoggedTotals();

    if (isFullTime(person)) {
      availableHours += ledger.availableHours;
      plannedProjectFt += ledger.plannedProjectHours;
      plannedPto += ledger.plannedPtoHours;
      plannedBench += ledger.plannedBenchHours;
      loggedProjectFt += logged.project;
      loggedPto += logged.pto;
      loggedBench += logged.bench;
    } else {
      plannedProjectHourly += ledger.plannedProjectHours;
      loggedProjectHourly += logged.project;
    }
  }

  const gate = (value: number) => (canViewLogged ? value : null);
  const plannedProjectTotal = plannedProjectFt + plannedProjectHourly;
  const loggedProjectTotal = loggedProjectFt + loggedProjectHourly;

  return {
    availableHours,
    fullTimeProject: metric(
      plannedProjectFt,
      gate(loggedProjectFt),
      availableHours,
    ),
    pto: metric(plannedPto, gate(loggedPto), availableHours),
    bench: metric(plannedBench, gate(loggedBench), availableHours),
    projectHours: series(plannedProjectTotal, gate(loggedProjectTotal)),
    projectHoursHourly: series(plannedProjectHourly, gate(loggedProjectHourly)),
    hourlyProjectShare: {
      planned: shareOf(plannedProjectHourly, plannedProjectTotal),
      confirmed: canViewLogged
        ? shareOf(loggedProjectHourly, loggedProjectTotal)
        : null,
    },
  };
}

/** One row per person: capacity, and project / PTO / bench hours against it. */
export function buildStaffBreakdown(
  cohort: UtilizationStaff[],
  ledgers: Map<string, StaffLedger>,
  loggedTotals: Map<string, LoggedTotals>,
  canViewLogged: boolean,
): StaffBreakdownRow[] {
  return cohort
    .map((person) => {
      const ledger = ledgers.get(person.id) ?? emptyLedger();
      const logged = loggedTotals.get(person.id) ?? emptyLoggedTotals();
      const gate = (value: number) => (canViewLogged ? value : null);
      const fullTime = isFullTime(person);
      const availableHours = fullTime ? ledger.availableHours : null;

      return {
        staffId: person.id,
        name: person.name,
        role: person.role,
        lineOfBusiness: person.lineOfBusiness,
        employmentType: person.employmentType,
        availableHours,
        project: metric(
          ledger.plannedProjectHours,
          gate(logged.project),
          availableHours,
        ),
        // PTO and bench are full-time measures — see the module header.
        pto: fullTime
          ? metric(ledger.plannedPtoHours, gate(logged.pto), availableHours)
          : null,
        bench: fullTime
          ? metric(ledger.plannedBenchHours, gate(logged.bench), availableHours)
          : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Where each person's time sits by line of business, one row per person. Both
 * series count **hours** so a row's percentages are comparable across the basis
 * toggle; the attribution rule is stated once on `buildStaffLedger` (planned) and
 * `buildLoggedTotals` (logged), and is deliberately identical on both sides.
 */
export function buildLobAlignment(
  cohort: UtilizationStaff[],
  ledgers: Map<string, StaffLedger>,
  loggedTotals: Map<string, LoggedTotals>,
  canViewLogged: boolean,
): LobAlignmentRow[] {
  return cohort
    .map((person) => {
      const planned = ledgers.get(person.id)?.lobHours ?? emptyLobHours();
      const logged = canViewLogged
        ? (loggedTotals.get(person.id)?.lobHours ?? emptyLobHours())
        : null;
      return {
        staffId: person.id,
        name: person.name,
        role: person.role,
        lineOfBusiness: person.lineOfBusiness,
        employmentType: person.employmentType,
        planned,
        logged,
        plannedTotal: sumLobHours(planned),
        loggedTotal: logged == null ? null : sumLobHours(logged),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Aggregate line-of-business rows into one cohort row. Takes the rows the reader
 * can currently see, so the footer always describes the table above it rather
 * than an unfiltered cohort they aren't looking at.
 */
export function sumLobAlignment(rows: readonly LobAlignmentRow[]): {
  planned: LobHours;
  logged: LobHours | null;
  plannedTotal: number;
  loggedTotal: number | null;
} {
  const planned = emptyLobHours();
  const logged = emptyLobHours();
  let hasLogged = false;

  for (const row of rows) {
    for (const lob of LINE_OF_BUSINESS) {
      planned[lob] += row.planned[lob];
      if (row.logged != null) logged[lob] += row.logged[lob];
    }
    if (row.logged != null) hasLogged = true;
  }

  return {
    planned,
    logged: hasLogged ? logged : null,
    plannedTotal: sumLobHours(planned),
    loggedTotal: hasLogged ? sumLobHours(logged) : null,
  };
}

/** How much of the cohort's in-range time is actually backed by submitted weeks. */
export function buildCoverage(
  cohort: UtilizationStaff[],
  ledgers: Map<string, StaffLedger>,
  weeksByStaff: Map<string, UtilizationWeek[]>,
  canViewLogged: boolean,
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
  return { weeksSubmitted: submitted, weeksTotal: total, canViewLogged };
}
