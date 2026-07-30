import "server-only";

import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/auth";
import { requirePermission } from "@/lib/auth/permissions";
import { db } from "@/lib/db/db";
import { staff, staffBonusPayment } from "@/lib/db/schema";
import type { Currency } from "@/lib/format/currency";
import {
  BONUS_PAYMENT_WRITE_ACCESS,
  type BonusType,
} from "@/lib/staff/staff-bonus";

/**
 * One payment WITH the recipient's identity — unlike the dashboard's anonymized
 * `BonusRecord`. The entry screen exists to correct a specific person's payment,
 * so it necessarily names them; that is why this read carries the stricter
 * write-level gate rather than the read-level one.
 */
export type BonusPaymentRow = {
  id: string;
  staffId: string;
  staffName: string;
  paymentDate: string;
  type: BonusType;
  amount: number;
  currency: Currency;
  notes: string | null;
};

/** A staff member the entry form can record a payment against. */
export type BonusStaffOption = { id: string; name: string };

export type BonusPaymentsPage = {
  payments: BonusPaymentRow[];
  /** Active staff only — you don't record a new bonus against someone who left. */
  staffOptions: BonusStaffOption[];
  /** Every calendar year with a payment, newest first. */
  years: number[];
};

/**
 * The bonus-payments entry screen: one calendar year's payments, newest first,
 * plus the staff list its form needs.
 *
 * Gated by `BONUS_PAYMENT_WRITE_ACCESS` (`staff.edit` AND
 * `staff.viewCompensation`) — the same gate as the mutations, because this read is
 * identity-bearing money data whose only purpose is to be edited. `finance` can
 * see the aggregate dashboard but not this. A permission failure throws.
 *
 * Existing payments are listed for ALL staff including leavers (a payment to
 * someone who has since left is still a payment, and may still need correcting);
 * only the *form's* options are narrowed to active staff.
 */
export async function getBonusPayments(
  year: number,
): Promise<BonusPaymentsPage> {
  const user = await getCurrentUser();
  requirePermission(user ?? { role: null }, BONUS_PAYMENT_WRITE_ACCESS);

  const [payments, staffOptions, allDates] = await Promise.all([
    db
      .select({
        id: staffBonusPayment.id,
        staffId: staffBonusPayment.staffId,
        staffName: staff.name,
        paymentDate: staffBonusPayment.paymentDate,
        type: staffBonusPayment.type,
        amount: staffBonusPayment.amount,
        currency: staffBonusPayment.currency,
        notes: staffBonusPayment.notes,
      })
      .from(staffBonusPayment)
      .innerJoin(staff, eq(staffBonusPayment.staffId, staff.id))
      .where(
        and(
          gte(staffBonusPayment.paymentDate, `${year}-01-01`),
          lte(staffBonusPayment.paymentDate, `${year}-12-31`),
        ),
      )
      .orderBy(desc(staffBonusPayment.paymentDate), asc(staff.name)),
    db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .where(eq(staff.isActive, true))
      .orderBy(asc(staff.name)),
    db
      .selectDistinct({ paymentDate: staffBonusPayment.paymentDate })
      .from(staffBonusPayment),
  ]);

  const years = [
    ...new Set(
      allDates.map((r) => Number.parseInt(r.paymentDate.slice(0, 4), 10)),
    ),
  ].sort((a, b) => b - a);

  return { payments, staffOptions, years };
}
