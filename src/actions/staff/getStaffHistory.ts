import "server-only";

import { desc, eq } from "drizzle-orm";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { db } from "@/lib/db/db";
import { staffBonusPayment, staffEmployment } from "@/lib/db/schema";
import { type Currency, formatMoney } from "@/lib/format/currency";
import { BONUS_TYPE_LABELS } from "@/lib/staff/staff-bonus";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";

/**
 * The kinds of change in a person's history feed. Employment carries compensation
 * inline; `BONUS` is a dated payment rather than a change of terms. Allocation
 * will join them — extend the union (and add a fetch + map below) when it lands.
 */
export type HistoryCategory = "EMPLOYMENT" | "BONUS" | "ALLOCATION";

/** One dated event in the history feed, regardless of source. */
export type HistoryEntry = {
  id: string;
  /** Effective / payment date, "YYYY-MM-DD" (wall-clock, no zone). */
  date: string;
  category: HistoryCategory;
  /** Display-ready one-line summary of what changed. */
  summary: string;
};

/** A row's compensation, as `["Base CA$150,000.00", …]` — a zero bonus omitted. */
function compParts(row: {
  base: number;
  hourlyRate: number;
  guaranteedBonus: number;
  currency: Currency;
}): string[] {
  const money = (amount: number) => formatMoney(amount, row.currency);
  const parts = [`Base ${money(row.base)}`, `Hourly ${money(row.hourlyRate)}`];
  if (row.guaranteedBonus)
    parts.push(`Guaranteed bonus ${money(row.guaranteedBonus)}`);
  return parts;
}

/** How much of a bonus's free-text note rides along in the one-line summary. */
const NOTES_SUMMARY_LIMIT = 60;

/**
 * Any staff member's history feed across domains, newest first. NOT
 * ownership-scoped (see getStaffProfile). Returns [] when the id has no history.
 *
 * Compensation is folded into the employment entry's summary (one entry per
 * effective-dated change, not a separate category). `includeCompensation` gates
 * whether those comp amounts are appended at all — history renders in a client
 * component (the profile's tabbed panel), so comp must be filtered here (at the
 * read) rather than in the UI, or it would ship to unauthorized clients. Pass the
 * result of `canViewCompensation`.
 *
 * The same flag omits bonus entries **entirely** rather than stripping their
 * amounts: that a bonus was paid, and when, is itself compensation information, so
 * an amount-less "Spot bonus" entry would still leak it.
 */
export async function getStaffHistory(
  staffId: string,
  includeCompensation = false,
): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = [];

  const employment = await db
    .select({
      id: staffEmployment.id,
      effectiveFromDate: staffEmployment.effectiveFromDate,
      lineOfBusiness: staffEmployment.lineOfBusiness,
      role: staffEmployment.role,
      employmentType: staffEmployment.employmentType,
      isBillable: staffEmployment.isBillable,
      base: staffEmployment.base,
      hourlyRate: staffEmployment.hourlyRate,
      guaranteedBonus: staffEmployment.guaranteedBonus,
      currency: staffEmployment.currency,
    })
    .from(staffEmployment)
    .where(eq(staffEmployment.staffId, staffId))
    .orderBy(...latestEmploymentFirst);

  for (const row of employment) {
    const summary = [
      ROLE_LABELS[row.role],
      LINE_OF_BUSINESS_LABELS[row.lineOfBusiness],
      EMPLOYMENT_TYPE_LABELS[row.employmentType],
      row.isBillable ? "Billable" : "Non-billable",
      // Comp is appended to the same entry, gated for authorized viewers only.
      ...(includeCompensation ? compParts(row) : []),
    ].join(" · ");
    entries.push({
      id: row.id,
      date: row.effectiveFromDate,
      category: "EMPLOYMENT",
      summary,
    });
  }

  // Bonus payments — dated events, not changes of terms, so they get their own
  // category rather than folding into an employment entry. Skipped wholesale for
  // an unauthorized viewer (see the note above): the amounts are comp, and so is
  // the mere fact of a payment.
  if (includeCompensation) {
    const bonuses = await db
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

    for (const row of bonuses) {
      const note = row.notes?.trim();
      entries.push({
        id: row.id,
        date: row.paymentDate,
        category: "BONUS",
        summary: [
          `${BONUS_TYPE_LABELS[row.type]} bonus`,
          formatMoney(row.amount, row.currency),
          ...(note
            ? [
                note.length > NOTES_SUMMARY_LIMIT
                  ? `${note.slice(0, NOTES_SUMMARY_LIMIT)}…`
                  : note,
              ]
            : []),
        ].join(" · "),
      });
    }
  }

  // Newest first across every category. "YYYY-MM-DD" sorts chronologically;
  // Array.sort is stable, so equal-date entries keep per-source insertion order.
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
