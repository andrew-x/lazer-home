import { ISO_DATE, isCalendarDate } from "@/lib/date-schema";
import type { ParsedDate, RawRow } from "./types";

/**
 * Dependency-free parsing primitives shared by the admin CSV transforms. They
 * run on the client right after PapaParse, so they stay side-effect free.
 */

/** Normalize a header key for tolerant (whitespace/case-insensitive) matching. */
export const normalizeKey = (key: string) => key.trim().toLowerCase();

/** Read a column by header name, tolerant of surrounding whitespace/casing. */
export function getField(row: RawRow, header: string): string {
  const direct = row[header];
  if (direct != null) return String(direct).trim();
  const wanted = normalizeKey(header);
  for (const [key, value] of Object.entries(row)) {
    if (normalizeKey(key) === wanted && value != null) {
      return String(value).trim();
    }
  }
  return "";
}

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Parse common Rippling date formats to "YYYY-MM-DD"; blank → null. Rejects
 * impossible calendar dates (e.g. 2/30/2026) via the shared `isCalendarDate`
 * round-trip, so a bad cell fails the import rather than silently rolling over.
 */
export function parseDate(input: string): ParsedDate {
  const value = input.trim();
  if (!value) return { ok: true, value: null };
  if (ISO_DATE.test(value)) {
    return isCalendarDate(value) ? { ok: true, value } : { ok: false };
  }
  const match = US_DATE.exec(value);
  if (match) {
    const [, month, day, year] = match;
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    return isCalendarDate(iso) ? { ok: true, value: iso } : { ok: false };
  }
  return { ok: false };
}

/**
 * Parse a money/number cell, tolerant of currency symbols, thousands separators,
 * and surrounding whitespace (e.g. "CA$150,000.00" → 150000). Blank, unparseable,
 * or negative → null.
 */
export function parseNumber(input: string): number | null {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Type-guard for `.filter(...)` that drops falsy sentinels (false, ""). */
export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * Tracks Rippling IDs seen within a single file so a second occurrence can be
 * skipped: a duplicate create would hit the unique constraint and roll back the
 * whole commit transaction.
 */
export function createDuplicateTracker() {
  const seen = new Map<string, number>();
  return {
    /**
     * Records `id` at `rowNumber`. Returns the row number of the first
     * occurrence if this id was already seen, else null (and records it).
     */
    firstSeenAt(id: string, rowNumber: number): number | null {
      const first = seen.get(id);
      if (first !== undefined) return first;
      seen.set(id, rowNumber);
      return null;
    },
  };
}
