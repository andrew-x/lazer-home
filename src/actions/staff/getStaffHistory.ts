import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { staffEmployment } from "@/lib/db/schema";
import { humanizeEnum } from "@/lib/format";

/**
 * The kinds of change in a person's history feed. Employment is the only source
 * today; compensation and allocation will join it. Extend the union (and add a
 * fetch + map below) when they land.
 */
export type HistoryCategory = "EMPLOYMENT" | "COMPENSATION" | "ALLOCATION";

/** One effective-dated change in the history feed, regardless of source. */
export type HistoryEntry = {
  id: string;
  /** Effective date, "YYYY-MM-DD" (wall-clock, no zone). */
  date: string;
  category: HistoryCategory;
  /** Display-ready one-line summary of what changed. */
  summary: string;
};

/**
 * Any staff member's history feed across domains, newest first. NOT
 * ownership-scoped (see getStaffProfile). Returns [] when the id has no history.
 */
export async function getStaffHistory(
  staffId: string,
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
    })
    .from(staffEmployment)
    .where(eq(staffEmployment.staffId, staffId))
    .orderBy(
      desc(staffEmployment.effectiveFromDate),
      desc(staffEmployment.createdAt),
    );

  for (const row of employment) {
    entries.push({
      id: row.id,
      date: row.effectiveFromDate,
      category: "EMPLOYMENT",
      summary: [
        humanizeEnum(row.role),
        humanizeEnum(row.lineOfBusiness),
        humanizeEnum(row.employmentType),
        row.isBillable ? "Billable" : "Non-billable",
      ].join(" · "),
    });
  }

  // Newest first across every category. "YYYY-MM-DD" sorts chronologically;
  // Array.sort is stable, so equal-date entries keep per-source insertion order.
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
