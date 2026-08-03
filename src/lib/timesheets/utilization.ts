/**
 * Utilization **year to date** — from 1 January through today, never beyond. A
 * pure, client-importable module (no `db`/drizzle, no React) so the arithmetic is
 * testable. See docs/domains/timesheets.md.
 *
 * This now serves **one** caller: the home dashboard's *personal* tiles, via
 * `getStaffUtilization`. It used to back an org-wide cohort table on the same page
 * as well; that table was replaced by a point-in-time, staffing-plan-based panel
 * (`@/lib/home/org-status`), because "how much of the bench is working *now*" is a
 * plan question and answering it from partial timesheet coverage read low coverage
 * as low utilization. The cohort/suppression machinery went with it.
 *
 * So the surviving contract is per-person and cumulative. Anything measuring the
 * *organization* belongs either in `@/lib/home/org-status` (point in time, from the
 * plan) or `@/lib/utilization/utilization-report` (plan reconciled against actuals
 * over a chosen range, ADR 0062) — don't grow a third org aggregator here.
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
 * ratios is the tempting bug — {@link computeUtilization} takes arrays for that
 * reason, even though only one record is passed today.
 */

import type { AllocationRoleRow } from "@/actions/allocations/getAllocationsGrid";
import type { DateSpan } from "@/lib/allocations/weekdays";
import {
  activeWeekdays,
  awayWeekdays,
  totalWeekdays,
} from "@/lib/allocations/weekdays";

/** A full working day — the capacity baseline, mirroring the allocations planner. */
const HOURS_PER_DAY = 8;

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
