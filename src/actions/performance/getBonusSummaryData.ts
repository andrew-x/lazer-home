import "server-only";

import { and, gte, lte } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/auth";
import { requirePermission } from "@/lib/auth/permissions";
import { groupPerKey } from "@/lib/core/collections";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import { db } from "@/lib/db/db";
import { staffBonusPayment, staffEmployment } from "@/lib/db/schema";
import type { Currency } from "@/lib/format/currency";
import { employmentAsOf } from "@/lib/staff/bonus-attribution";
import {
  BONUS_PAYMENT_READ_ACCESS,
  type BonusType,
} from "@/lib/staff/staff-bonus";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import type { EmploymentType, Role } from "@/lib/staff/staff-enums";

/**
 * One bonus payment, dimensioned for the dashboard.
 *
 * **Anonymized — carries no identity**, the same contract as `CompensationRecord`.
 *
 * `recipientKey` is a per-request sequential token, NOT the staff id. The
 * distinction matters: the client needs to count *distinct* recipients (one person
 * paid three times is one recipient), which takes a per-person key — but a staff
 * id is joinable. `getStaffDirectory` hands ids to any active staff member and
 * `loadStaffProfileDrawer` takes one as input, so shipping the real id would let
 * an authorized viewer map exact bonus amounts back to named people from a surface
 * whose whole point is that it shows aggregates only. A token that is reassigned
 * every request joins to nothing.
 *
 * If a future breakdown needs an identity-linked attribute, derive it server-side
 * *before* building the row.
 */
export type BonusRecord = {
  recipientKey: string;
  lineOfBusiness: LineOfBusiness;
  role: Role;
  employmentType: EmploymentType;
  type: BonusType;
  amount: number;
  currency: Currency;
};

export type BonusSummaryData = {
  records: BonusRecord[];
  /** Every calendar year with at least one payment, newest first, for the year picker. */
  years: number[];
  /**
   * Payments in the window we could not dimension because the person has no
   * employment row at all. Surfaced rather than swallowed: the total on screen is
   * short by this many payments, and a silent under-report in a spend figure is
   * worse than an ugly caveat.
   */
  unattributed: number;
};

/** Calendar-year bounds as inclusive `"YYYY-MM-DD"` strings (no Date, no zones). */
function yearBounds(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/**
 * Bonus payments for one calendar year, dimensioned by the employment row in
 * force on each payment date, for the compensation dashboard.
 *
 * Gated by `staff.viewCompensation` — an aggregate bonus view is bulk comp
 * exposure, so it must never ship to an unauthorized viewer. A permission failure
 * throws (via `requirePermission`); an empty year returns empty records.
 *
 * **Deliberately NOT filtered to active staff**, unlike the headcount/comp reads
 * on the same page: a bonus paid in March to someone who left in June was still
 * spent this year. The consequence is that this section does not reconcile
 * per-head with the tables above it, which the UI says out loud.
 */
export async function getBonusSummaryData(
  year: number,
): Promise<BonusSummaryData> {
  // A null user falls through to a default-deny role, so this throws rather than
  // dereferencing null.
  const user = await getCurrentUser();
  requirePermission(user ?? { role: null }, BONUS_PAYMENT_READ_ACCESS);

  const { from, to } = yearBounds(year);

  // Two queries, no N+1: the year's payments, and every employment row (ordered
  // newest-first) so each payment can be resolved as-of its own date.
  const [payments, employmentRows] = await Promise.all([
    db
      .select({
        staffId: staffBonusPayment.staffId,
        paymentDate: staffBonusPayment.paymentDate,
        type: staffBonusPayment.type,
        amount: staffBonusPayment.amount,
        currency: staffBonusPayment.currency,
      })
      .from(staffBonusPayment)
      .where(
        and(
          gte(staffBonusPayment.paymentDate, from),
          lte(staffBonusPayment.paymentDate, to),
        ),
      ),
    db
      .select({
        staffId: staffEmployment.staffId,
        effectiveFromDate: staffEmployment.effectiveFromDate,
        lineOfBusiness: staffEmployment.lineOfBusiness,
        role: staffEmployment.role,
        employmentType: staffEmployment.employmentType,
      })
      .from(staffEmployment)
      .orderBy(...latestEmploymentFirst),
  ]);

  const employmentByStaff = groupPerKey(employmentRows, (row) => row.staffId);

  // Staff id → per-request token, so the shipped rows can be counted by recipient
  // without carrying a value that joins back to a person. Assigned in payment
  // order, which no client can invert into an identity.
  const tokens = new Map<string, string>();
  const tokenFor = (staffId: string): string => {
    const existing = tokens.get(staffId);
    if (existing) return existing;
    const token = `r${tokens.size}`;
    tokens.set(staffId, token);
    return token;
  };

  const records: BonusRecord[] = [];
  let unattributed = 0;
  for (const payment of payments) {
    const employment = employmentAsOf(
      employmentByStaff.get(payment.staffId) ?? [],
      payment.paymentDate,
    );
    if (!employment) {
      unattributed += 1;
      continue;
    }
    records.push({
      recipientKey: tokenFor(payment.staffId),
      lineOfBusiness: employment.lineOfBusiness,
      role: employment.role,
      employmentType: employment.employmentType,
      type: payment.type,
      amount: payment.amount,
      currency: payment.currency,
    });
  }

  return { records, years: await paymentYears(), unattributed };
}

/**
 * Every calendar year that has a payment, newest first — the year picker's
 * options. A separate read because it spans all time, not the selected year.
 * Called only from a function that has already gated.
 */
async function paymentYears(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ paymentDate: staffBonusPayment.paymentDate })
    .from(staffBonusPayment);
  const years = new Set(
    rows.map((r) => Number.parseInt(r.paymentDate.slice(0, 4), 10)),
  );
  return [...years].sort((a, b) => b - a);
}
