/**
 * Pure working-day math for PTO spans. A client-importable module (no `db`, no
 * React) so both the per-staff read (`getStaffPto`) and the project-wide read
 * (`getProjectPto`) count Mon–Fri days the same way. See docs/domains/staff.md.
 */

import { parseIsoDate } from "@/lib/format/format";

/** Count Mon–Fri days in the inclusive "YYYY-MM-DD" span (no half-days here). */
export function countWorkingDays(startDate: string, endDate: string): number {
  const cursor = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);

  let count = 0;
  while (cursor <= end) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}
