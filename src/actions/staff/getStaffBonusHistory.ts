import "server-only";

import { desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/auth";
import { db } from "@/lib/db/db";
import { staffBonusPayment } from "@/lib/db/schema";
import type { Currency } from "@/lib/format/currency";
import type { BonusType } from "@/lib/staff/staff-bonus";
import { canViewCompensation } from "./canViewCompensation";

/** One bonus payment to this person. */
export type StaffBonusEntry = {
  id: string;
  paymentDate: string;
  type: BonusType;
  amount: number;
  currency: Currency;
  notes: string | null;
};

export type StaffBonusView = {
  /** Newest first. */
  entries: StaffBonusEntry[];
  /**
   * Current-calendar-year totals, one per currency the person was paid in,
   * largest first. Per-currency rather than one number because this is a
   * per-person view and does **no** FX: summing CAD and USD into a single figure
   * would be a made-up number. Empty when there are no payments this year.
   */
  ytdTotals: { currency: Currency; total: number }[];
};

/**
 * One person's bonus payments, newest first, plus their year-to-date totals.
 *
 * Authorization: a user always sees their OWN bonuses; anyone else's needs
 * `staff.viewCompensation` — the same rule as the rest of their compensation, via
 * the one decision point (`canViewCompensation`). Returns `null` when not
 * permitted, so callers hide the section rather than error.
 */
export async function getStaffBonusHistory(
  staffId: string,
): Promise<StaffBonusView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!(await canViewCompensation(user, staffId))) return null;

  const rows = await db
    .select({
      id: staffBonusPayment.id,
      paymentDate: staffBonusPayment.paymentDate,
      type: staffBonusPayment.type,
      amount: staffBonusPayment.amount,
      currency: staffBonusPayment.currency,
      notes: staffBonusPayment.notes,
    })
    .from(staffBonusPayment)
    .where(eq(staffBonusPayment.staffId, staffId))
    .orderBy(desc(staffBonusPayment.paymentDate));

  return { entries: rows, ytdTotals: ytdTotalsByCurrency(rows) };
}

/**
 * Sum the current calendar year's payments per currency. The year prefix is
 * compared as a string — `paymentDate` is a wall-clock `"YYYY-MM-DD"`, so no
 * `Date` parsing and no chance of a zone shifting a January payment into last
 * year.
 */
function ytdTotalsByCurrency(
  rows: readonly StaffBonusEntry[],
): { currency: Currency; total: number }[] {
  const yearPrefix = `${new Date().getFullYear()}-`;
  const totals = new Map<Currency, number>();
  for (const row of rows) {
    if (!row.paymentDate.startsWith(yearPrefix)) continue;
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amount);
  }
  return [...totals]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total);
}
