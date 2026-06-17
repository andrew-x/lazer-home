import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { type StaffPto, staffPto } from "@/lib/db/schema";

export type PtoType = StaffPto["type"];

/** A single leave span with its Mon–Fri working-day count precomputed. */
export type PtoSpan = {
  id: string;
  startDate: string;
  endDate: string;
  type: PtoType;
  isPending: boolean;
  workingDays: number;
};

/** Total working days for one category (only non-zero categories appear). */
export type PtoCategorySummary = { type: PtoType; workingDays: number };

export type StaffPtoView = {
  /** Not yet ended (endDate >= today), soonest first. */
  upcoming: PtoSpan[];
  /** Already ended (endDate < today), most recent first. */
  past: PtoSpan[];
  /**
   * Per-category working-day totals for the CURRENT calendar year, largest
   * first. Spans straddling a year boundary are clamped to the year.
   */
  summary: PtoCategorySummary[];
};

/** Today as a wall-clock "YYYY-MM-DD" string (dates are timezone-agnostic). */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Count Mon–Fri days in the inclusive "YYYY-MM-DD" span (no half-days here). */
function countWorkingDays(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);

  let count = 0;
  while (cursor <= end) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Any staff member's time off: upcoming and past spans plus a per-category
 * working-day summary. NOT ownership-scoped (see getStaffProfile). Counts include
 * pending requests — the list flags those.
 */
export async function getStaffPto(staffId: string): Promise<StaffPtoView> {
  const rows = await db
    .select({
      id: staffPto.id,
      startDate: staffPto.startDate,
      endDate: staffPto.endDate,
      type: staffPto.type,
      isPending: staffPto.isPending,
    })
    .from(staffPto)
    .where(eq(staffPto.staffId, staffId))
    .orderBy(asc(staffPto.startDate));

  const today = todayIso();
  const currentYear = new Date().getFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;
  const upcoming: PtoSpan[] = [];
  const past: PtoSpan[] = [];
  const totals = new Map<PtoType, number>();

  for (const row of rows) {
    const workingDays = countWorkingDays(row.startDate, row.endDate);
    const span: PtoSpan = { ...row, workingDays };

    if (row.endDate >= today) upcoming.push(span);
    else past.push(span);

    // Summary totals count only the portion of each span within this calendar
    // year (clamp to the year bounds — "YYYY-MM-DD" strings compare chronologically).
    const clampStart = row.startDate > yearStart ? row.startDate : yearStart;
    const clampEnd = row.endDate < yearEnd ? row.endDate : yearEnd;
    if (clampStart <= clampEnd) {
      const yearWorkingDays = countWorkingDays(clampStart, clampEnd);
      if (yearWorkingDays > 0) {
        totals.set(row.type, (totals.get(row.type) ?? 0) + yearWorkingDays);
      }
    }
  }

  // Past spans most-recent first (the query returned them oldest first).
  past.reverse();

  const summary: PtoCategorySummary[] = [...totals.entries()]
    .map(([type, workingDays]) => ({ type, workingDays }))
    .sort((a, b) => b.workingDays - a.workingDays);

  return { upcoming, past, summary };
}
