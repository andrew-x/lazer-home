import "server-only";

import { desc, eq } from "drizzle-orm";
import { type Currency, formatMoney } from "@/lib/currency";
import { db } from "@/lib/db/db";
import { staffEmployment } from "@/lib/db/schema";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/line-of-business";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff-enums";

/**
 * The kinds of change in a person's history feed. Employment (which now carries
 * compensation inline) is the only source today; allocation will join it. Extend
 * the union (and add a fetch + map below) when it lands.
 */
export type HistoryCategory = "EMPLOYMENT" | "ALLOCATION";

/** One effective-dated change in the history feed, regardless of source. */
export type HistoryEntry = {
  id: string;
  /** Effective date, "YYYY-MM-DD" (wall-clock, no zone). */
  date: string;
  category: HistoryCategory;
  /** Display-ready one-line summary of what changed. */
  summary: string;
};

/** A row's compensation, as `["Base CA$150,000.00", …]` — zero bonuses omitted. */
function compParts(row: {
  base: number;
  hourlyRate: number;
  guaranteedBonus: number;
  discretionaryBonus: number;
  currency: Currency;
}): string[] {
  const money = (amount: number) => formatMoney(amount, row.currency);
  const parts = [`Base ${money(row.base)}`, `Hourly ${money(row.hourlyRate)}`];
  if (row.guaranteedBonus)
    parts.push(`Guaranteed bonus ${money(row.guaranteedBonus)}`);
  if (row.discretionaryBonus)
    parts.push(`Discretionary bonus ${money(row.discretionaryBonus)}`);
  return parts;
}

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
      discretionaryBonus: staffEmployment.discretionaryBonus,
      currency: staffEmployment.currency,
    })
    .from(staffEmployment)
    .where(eq(staffEmployment.staffId, staffId))
    .orderBy(
      desc(staffEmployment.effectiveFromDate),
      desc(staffEmployment.createdAt),
    );

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

  // Newest first across every category. "YYYY-MM-DD" sorts chronologically;
  // Array.sort is stable, so equal-date entries keep per-source insertion order.
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
