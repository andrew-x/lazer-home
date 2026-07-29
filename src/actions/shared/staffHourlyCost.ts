import "server-only";

import { eq, inArray } from "drizzle-orm";
import { employmentCompColumns } from "@/actions/shared/employmentComp";
import { firstPerKey } from "@/lib/core/collections";
import { db } from "@/lib/db/db";
import { staff, staffEmployment } from "@/lib/db/schema";
import type { Currency } from "@/lib/format/currency";
import { convert } from "@/lib/format/fx";
import { convertCompUnit } from "@/lib/performance/compensation-unit";
import type { NativeMoney } from "@/lib/projects/project-margin";
import {
  PROJECT_ROLE_TYPES,
  type ProjectRoleType,
  STAFF_ROLE_FOR_PROJECT_ROLE_TYPE,
} from "@/lib/projects/project-role-type";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import { isBillableRole } from "@/lib/staff/staff-enums";

/**
 * What an hour of someone's time costs — the cost side of a project's margin.
 *
 * ⚠️ Every value this module produces is derived from individual compensation, so
 * no caller may ship it to a client without `projects.viewMargin`. The one place
 * that decision is made is `getProjectCostBasis`; call that, not this.
 */

/**
 * One person's native hourly cost from their employment row: an hourly worker's
 * `hourlyRate` as-is, a salaried person's annual `base` restated hourly.
 *
 * The restatement uses the company's flat `HOURS_PER_YEAR` convention (via
 * `convertCompUnit`, the same transform the compensation editor's annual/hourly
 * toggle uses) rather than scaling by `utilizationTarget` — so the same salary
 * always yields the same hourly figure, and a project's cost doesn't silently move
 * when someone's utilization target is revised.
 *
 * Bonuses are excluded: `base` is the committed number, and a guaranteed or
 * discretionary bonus is a compensation-cycle outcome rather than a cost of
 * delivering these hours.
 */
export function hourlyCostOf(row: {
  employmentType: "FULL_TIME" | "HOURLY";
  base: number;
  hourlyRate: number;
  currency: Currency;
}): NativeMoney {
  return {
    amount:
      row.employmentType === "HOURLY"
        ? row.hourlyRate
        : convertCompUnit(row.base, "ANNUAL", "HOURLY"),
    currency: row.currency,
  };
}

/**
 * Latest-employment hourly cost for the given staff ids, keyed by staff id. Two
 * queries and a JS fold, no N+1 — the same `latestEmploymentFirst` + `firstPerKey`
 * shape every other effective-dated read uses (ADR 0007). Someone with no
 * employment row is simply absent from the map; the caller reports that as an
 * unknown cost rather than a zero.
 */
export async function getStaffHourlyCosts(
  staffIds: readonly string[],
): Promise<Map<string, NativeMoney>> {
  if (staffIds.length === 0) return new Map();

  const employmentRows = await db
    .select(employmentCompColumns)
    .from(staffEmployment)
    .where(inArray(staffEmployment.staffId, [...staffIds]))
    .orderBy(...latestEmploymentFirst);

  const latestByStaff = firstPerKey(employmentRows, (row) => row.staffId);

  return new Map(
    [...latestByStaff].map(([staffId, row]) => [staffId, hourlyCostOf(row)]),
  );
}

/**
 * Company-wide average hourly cost per project role type, **in USD** — the cost
 * basis for an OPEN (unstaffed) role, where there is no person to price.
 *
 * Averaged in one canonical currency and converted at the display edge, so the
 * client's CAD/USD toggle needs no re-read *and* no individual amount ever leaves
 * the server — only a per-discipline mean.
 *
 * ENGINEER/DESIGNER/ARCHITECT/QA average the active staff whose latest employment
 * `role` matches 1:1 (see `STAFF_ROLE_FOR_PROJECT_ROLE_TYPE`). SPECIALIST has no
 * counterpart, so it averages every active person in a *billable* discipline —
 * excluding leadership/sales/solutions/operations, whose salaries are overhead and
 * would drag a delivery cost basis. That makes SPECIALIST an approximation by
 * construction; the UI labels the basis so it never reads as a real figure.
 *
 * A role type with no matching staff is ABSENT from the result, never 0: "we have
 * no basis for this" and "this is free" are different claims, and only one of them
 * is safe to put in a margin.
 */
export async function getRoleTypeAverageCostsUsd(
  usdRates: Record<Currency, number>,
): Promise<Partial<Record<ProjectRoleType, number>>> {
  const activeStaff = await db
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.isActive, true));
  const activeStaffIds = new Set(activeStaff.map((s) => s.id));

  const employmentRows = await db
    .select(employmentCompColumns)
    .from(staffEmployment)
    .orderBy(...latestEmploymentFirst);
  const latestByStaff = firstPerKey(employmentRows, (row) => row.staffId);

  // Bucket every active person's USD hourly cost by their staff role, plus one
  // pooled bucket of all billable disciplines for SPECIALIST.
  const byRole = new Map<string, number[]>();
  const billablePool: number[] = [];

  for (const [staffId, row] of latestByStaff) {
    if (!activeStaffIds.has(staffId)) continue;
    const native = hourlyCostOf(row);
    const usd = convert(native.amount, native.currency, "USD", usdRates);

    const bucket = byRole.get(row.role);
    if (bucket) bucket.push(usd);
    else byRole.set(row.role, [usd]);

    if (isBillableRole(row.role)) billablePool.push(usd);
  }

  const averages: Partial<Record<ProjectRoleType, number>> = {};
  for (const roleType of PROJECT_ROLE_TYPES) {
    const staffRole = STAFF_ROLE_FOR_PROJECT_ROLE_TYPE[roleType];
    const samples = staffRole ? byRole.get(staffRole) : billablePool;
    if (samples?.length) {
      averages[roleType] =
        samples.reduce((total, value) => total + value, 0) / samples.length;
    }
  }
  return averages;
}
