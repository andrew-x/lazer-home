/**
 * Pure grid math for the weekly timesheet editor. A client-importable module
 * (no `db`/drizzle, no React) so the grid component stays rendering + action
 * wiring only, and the tricky bits — row grouping/ordering, capacity autofill,
 * and the replace-payload build — are unit-testable in isolation. Every other
 * pure domain-math helper lives beside a `.test.ts` this way (`performance-stats`,
 * `fx`, `timesheet-week`). See docs/domains/timesheets.md.
 */

import type { TimesheetEntryView } from "@/actions/timesheets/getTimesheet";
import {
  TIMESHEET_CATEGORY_LABELS,
  type TimesheetCategory,
} from "@/lib/timesheet-category";
import { isWeekend } from "@/lib/timesheet-week";

/** A grid row: one target (project or category) with a value per weekday. */
export type Row = {
  key: string;
  label: string;
  sublabel: string | null;
  projectId: string | null;
  category: TimesheetCategory | null;
  hours: Record<string, string>;
};

/** The replace-semantics payload the grid submits to `saveTimesheet`. */
export type TimesheetPayload = {
  staffId: string;
  weekStartDate: string;
  entries: {
    date: string;
    projectId: string | null;
    category: TimesheetCategory | null;
    hours: number;
  }[];
};

export const PROJECT_PREFIX = "project:";
export const CATEGORY_PREFIX = "category:";

/** A stable key for a row's target — project id or category, never both. */
export function targetKey(
  projectId: string | null,
  category: TimesheetCategory | null,
): string {
  return projectId
    ? `${PROJECT_PREFIX}${projectId}`
    : `${CATEGORY_PREFIX}${category}`;
}

/** Parse a cell's raw text into non-negative hours (blank / invalid → 0). */
export function parseHours(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Group the flat entries into one row per target, preserving stable ordering. */
export function buildRows(
  entries: TimesheetEntryView[],
  categoryOrder: readonly TimesheetCategory[],
): Row[] {
  const byKey = new Map<string, Row>();
  for (const e of entries) {
    const key = targetKey(e.projectId, e.category);
    let row = byKey.get(key);
    if (!row) {
      row = {
        key,
        label:
          e.projectName ??
          (e.category ? TIMESHEET_CATEGORY_LABELS[e.category] : "—"),
        sublabel: e.projectId ? e.companyName : "Non-billable",
        projectId: e.projectId,
        category: e.category,
        hours: {},
      };
      byKey.set(key, row);
    }
    row.hours[e.date] = String(e.hours);
  }
  const rows = [...byKey.values()];
  // A category row's rank in the canonical order (project rows never reach here).
  const categoryRank = (category: TimesheetCategory | null) =>
    category ? categoryOrder.indexOf(category) : -1;
  // Projects (alpha) first, then non-billable categories in their canonical order.
  return rows.sort((a, b) => {
    if (a.projectId && b.projectId) return a.label.localeCompare(b.label);
    if (a.projectId) return -1;
    if (b.projectId) return 1;
    return categoryRank(a.category) - categoryRank(b.category);
  });
}

/**
 * Hours to prefill a newly-added PROJECT row with: each weekday's remaining
 * capacity (`dailyHourCap` minus what's already logged that day), so a project
 * soaks up unallocated weekday time. Weekends stay blank, as do fully-booked days.
 */
export function autofillProjectHours(
  rows: Row[],
  weekDays: string[],
  dailyHourCap: number,
): Record<string, string> {
  const filled: Record<string, string> = {};
  for (const date of weekDays) {
    if (isWeekend(date)) continue;
    const used = rows.reduce(
      (sum, row) => sum + parseHours(row.hours[date]),
      0,
    );
    const remaining = dailyHourCap - used;
    if (remaining > 0) filled[date] = String(remaining);
  }
  return filled;
}

/**
 * Flatten the grid into the save payload: one entry per non-zero weekday cell,
 * carrying the row's target. Replace semantics — omitted cells clear on save.
 */
export function buildPayload(
  rows: Row[],
  weekDays: string[],
  staffId: string,
  weekStartDate: string,
): TimesheetPayload {
  const entries = rows.flatMap((row) =>
    weekDays
      .map((date) => ({ date, hours: parseHours(row.hours[date]) }))
      .filter((cell) => cell.hours > 0)
      .map((cell) => ({
        date: cell.date,
        projectId: row.projectId,
        category: row.category,
        hours: cell.hours,
      })),
  );
  return { staffId, weekStartDate, entries };
}
