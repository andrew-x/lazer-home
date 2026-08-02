/**
 * Utilization **year to date** — from 1 January through today, never beyond. A
 * pure, client-importable module (no `db`/drizzle, no React) so the arithmetic is
 * testable and the personal tile and the org table share one definition. See
 * docs/domains/timesheets.md.
 *
 * Two rates, deliberately different questions:
 *
 * - **Actual** = `projectHours / (totalHours − ptoHours)` over the year's
 *   timesheets. Billability is *structural*, not a flag: a time entry targets
 *   either a project (billable) or a category (not) — see the
 *   `time_entries_target_check` constraint. `UNALLOCATED_BENCH` and
 *   `INTERNAL_ADMIN` stay in the denominator; they are unutilized capacity, which
 *   is the whole point. PTO comes out.
 *
 *   Dividing by *logged* hours is what keeps a partly-logged year honest: someone
 *   who has logged 12 of 31 weeks is measured on those 12, so thin timesheet
 *   adoption reads as *low coverage* (disclosed alongside), never as *low
 *   utilization*.
 *
 * - **Planned** = `allocatedHours / (nominalHours − ptoHours)` over the elapsed
 *   year, from **confirmed** roles only (a tentative allocation doesn't commit
 *   anyone — the same rule `latestConfirmedEnd` applies for the planner's sort).
 *   Deliberately **not** clamped: a genuinely over-allocated person plans above
 *   100% and the number must say so.
 *
 * Both stop at today. Nothing here looks forward — a role booked for November
 * contributes only the weekdays of it that have already passed.
 *
 * The two denominators differ in kind — actual divides by hours *recorded*, planned
 * by *calendar capacity* net of approved leave. That is not a defect to reconcile:
 * `staff_pto` (HR) and `time_entries.category = 'PTO'` (self-reported) are not
 * synced, and a blended denominator would reconcile with neither source. For
 * anyone logging full weeks the two coincide. Surfaces must label both columns and
 * footnote the difference rather than merging them.
 *
 * Aggregation is **sum-then-divide** (hours-weighted) throughout, so one person's
 * 4-hour week cannot outvote a colleague's 40-hour week. A mean of per-person
 * ratios is the tempting bug.
 */

import type { AllocationRoleRow } from "@/actions/allocations/getAllocationsGrid";
import type { DateSpan } from "@/lib/allocations/weekdays";
import {
  activeWeekdays,
  awayWeekdays,
  totalWeekdays,
} from "@/lib/allocations/weekdays";
import type { EmploymentType } from "@/lib/staff/staff-enums";

/** A full working day — the capacity baseline, mirroring the allocations planner. */
const HOURS_PER_DAY = 8;

/**
 * Below this many people, a cohort shows its headcount but not its rates. A
 * one-person "cohort" *is* an individual, and this surface is visible to every
 * signed-in user while individual timesheet hours are otherwise gated behind
 * `timesheets.edit` (see `getTimesheetList`). Suppression lives here, in the pure
 * layer, so it's testable rather than a rendering afterthought.
 */
export const MIN_COHORT_SIZE = 3;

/** One person's logged hours for the period, as summed by the timesheet reads. */
export type HoursRow = {
  /** Hours logged against projects — billable. */
  projectHours: number;
  /** Hours in the `PTO` category, broken out of the other non-billable buckets. */
  ptoHours: number;
  /** All logged hours, billable and not. */
  totalHours: number;
};

/** One person's planned capacity for the period, from roles and approved leave. */
export type PlanRow = {
  /** Confirmed allocation, in hours, landing inside the period. */
  allocatedHours: number;
  /** The period at full capacity — 8h × its Mon–Fri days. */
  nominalHours: number;
  /** Capacity removed by approved leave. */
  ptoHours: number;
};

/** A ratio kept alongside its parts, so callers can show the working. */
export type Rate = {
  numerator: number;
  denominator: number;
  /** 0–1 fraction for `formatPercent`, or null when there's nothing to divide by. */
  rate: number | null;
};

/** The pair of rates a utilization surface renders. */
export type UtilizationSummary = { actual: Rate; planned: Rate };

/**
 * One person's inputs, stripped of identity. The org read emits these — see
 * `getOrgUtilization`, which never lets a `staffId` leave the server.
 * `hours` is null when the person has logged no timesheet this year at all.
 */
export type UtilizationRecord = {
  employmentType: EmploymentType | null;
  utilizationTarget: number;
  hours: HoursRow | null;
  plan: PlanRow;
};

/**
 * A cohort's aggregated rates, plus how much of it actually reported. `UNKNOWN`
 * is anyone with no employment row (never defaulted into `FULL_TIME`); `OVERALL`
 * is the whole population, computed from the raw records rather than by averaging
 * the cohorts — averaging averages would drop the hours weighting.
 */
export type UtilizationGroup = {
  key: EmploymentType | "UNKNOWN" | "OVERALL";
  /** People in the cohort. */
  headcount: number;
  /** How many of them logged any time this year — the coverage disclosure. */
  logged: number;
  summary: UtilizationSummary;
  /** Capacity-weighted mean `utilizationTarget` as a 0–1 fraction, like-for-like
   * with the numerator. A headcount mean would not be comparable. */
  weightedTarget: number | null;
  /**
   * The cohort is too small to report without naming someone — see
   * {@link MIN_COHORT_SIZE}. Rates are nulled; `headcount` still renders.
   */
  suppressed: boolean;
};

function toRate(numerator: number, denominator: number): Rate {
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : null,
  };
}

/**
 * Allocated hours one role contributes to `[from, to]`: `hoursPerDay × its active
 * weekdays in the range`. Uses the same clamped weekday count as `weekPercent` in
 * `@/lib/allocations/allocations-grid`, so planned *hours* and the planner's
 * displayed *percent* cannot disagree about which days a role covers.
 *
 * A role extending past `to` contributes only the part that has elapsed, which is
 * what keeps the year-to-date figure from quietly counting future bookings.
 *
 * The unclamped equivalent is `roleBillableHours` in
 * `@/lib/projects/project-margin` — the same idea over a role's whole span.
 */
export function allocatedHoursInRange(
  role: Pick<AllocationRoleRow, "startDate" | "endDate" | "hoursPerDay">,
  from: string,
  to: string,
): number {
  return (
    role.hoursPerDay * activeWeekdays(from, to, role.startDate, role.endDate)
  );
}

/**
 * A person's plan over `[from, to]`: their confirmed allocation against the
 * range's working days, less approved leave. `roles` may include tentative rows —
 * they're filtered here so every caller gets the same confirmed-only rule.
 */
export function buildPlanRow(
  roles: readonly Pick<
    AllocationRoleRow,
    "status" | "startDate" | "endDate" | "hoursPerDay"
  >[],
  ptoSpans: readonly DateSpan[],
  from: string,
  to: string,
): PlanRow {
  if (from > to) {
    return { allocatedHours: 0, nominalHours: 0, ptoHours: 0 };
  }
  return {
    allocatedHours: roles
      .filter((role) => role.status === "confirmed")
      .reduce((sum, role) => sum + allocatedHoursInRange(role, from, to), 0),
    nominalHours: HOURS_PER_DAY * totalWeekdays(from, to),
    ptoHours: HOURS_PER_DAY * awayWeekdays(from, to, ptoSpans),
  };
}

/**
 * Aggregate a cohort into its two rates. `hours` entries that are null (nobody
 * logged) contribute nothing to either side of the actual rate — they are absent,
 * not zero, so thin timesheet adoption reads as *low coverage* rather than *low
 * utilization*. Their plan still counts: it's known regardless of logging.
 *
 * A plan denominator can go negative in principle (overlapping leave rows
 * exceeding the range); it's floored at zero so a fully-off period yields `0/0` →
 * null, not a negative rate.
 */
export function computeUtilization(
  hours: readonly (HoursRow | null)[],
  plan: readonly PlanRow[],
): UtilizationSummary {
  let billable = 0;
  let logged = 0;
  for (const row of hours) {
    if (!row) continue;
    billable += row.projectHours;
    logged += Math.max(0, row.totalHours - row.ptoHours);
  }

  let allocated = 0;
  let capacity = 0;
  for (const row of plan) {
    allocated += row.allocatedHours;
    capacity += Math.max(0, row.nominalHours - row.ptoHours);
  }

  return {
    actual: toRate(billable, logged),
    planned: toRate(allocated, capacity),
  };
}

/** The capacity-hours-weighted mean of a cohort's targets, as a 0–1 fraction. */
function weightedTargetOf(
  records: readonly UtilizationRecord[],
): number | null {
  let weighted = 0;
  let capacity = 0;
  for (const record of records) {
    const available = Math.max(
      0,
      record.plan.nominalHours - record.plan.ptoHours,
    );
    weighted += (record.utilizationTarget / 100) * available;
    capacity += available;
  }
  return capacity > 0 ? weighted / capacity : null;
}

/**
 * A fully withheld rate. The parts are zeroed, not merely the ratio: leaving the
 * numerator and denominator in place would make the suppression cosmetic, since
 * they *are* the individual's hours.
 *
 * Residual, worth knowing: a breakdown plus a total is always weakly invertible —
 * given Overall and every cohort but one, the missing cohort can be approximated
 * from the rounded displayed figures. Suppression removes the precise value, not
 * the arithmetic. Fully closing that would mean suppressing the large cohorts too,
 * which costs far more than the residual is worth on a surface where utilization
 * is deliberately open to everyone.
 */
const withheld = (): Rate => ({ numerator: 0, denominator: 0, rate: null });

function groupOf(
  key: UtilizationGroup["key"],
  records: readonly UtilizationRecord[],
  { suppressSmall = true }: { suppressSmall?: boolean } = {},
): UtilizationGroup {
  const summary = computeUtilization(
    records.map((r) => r.hours),
    records.map((r) => r.plan),
  );
  // A cohort of one or two is an individual wearing a cohort's clothes. Withhold
  // the rates rather than the row: the headcount is not the sensitive part, and
  // dropping the row entirely would make the table's numbers fail to add up.
  const suppressed =
    suppressSmall && records.length > 0 && records.length < MIN_COHORT_SIZE;

  return {
    key,
    headcount: records.length,
    logged: records.filter((r) => r.hours !== null).length,
    summary: suppressed ? { actual: withheld(), planned: withheld() } : summary,
    weightedTarget: suppressed ? null : weightedTargetOf(records),
    suppressed,
  };
}

/**
 * Split a population into employment-type cohorts (full time vs hourly, plus an
 * explicit UNKNOWN for anyone with no employment row — never defaulted into
 * `FULL_TIME`), alongside the overall figure. Cohorts are returned in a stable
 * order so the table doesn't reshuffle between renders, and an empty cohort is
 * still returned so the row can render "—" rather than a fabricated 0.0%.
 */
export function splitByEmploymentType(records: readonly UtilizationRecord[]): {
  overall: UtilizationGroup;
  groups: UtilizationGroup[];
  headcount: number;
  logged: number;
} {
  const order: UtilizationGroup["key"][] = ["FULL_TIME", "HOURLY", "UNKNOWN"];
  const groups = order
    .map((key) =>
      groupOf(
        key,
        records.filter((r) => (r.employmentType ?? "UNKNOWN") === key),
      ),
    )
    // Only surface UNKNOWN when someone actually lands there.
    .filter((group) => group.key !== "UNKNOWN" || group.headcount > 0);

  const overall = groupOf("OVERALL", records);
  return {
    overall,
    groups,
    headcount: overall.headcount,
    logged: overall.logged,
  };
}
