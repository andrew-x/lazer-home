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

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** Parse common Rippling date formats to "YYYY-MM-DD"; blank → null. */
export function parseDate(input: string): ParsedDate {
  const value = input.trim();
  if (!value) return { ok: true, value: null };
  if (ISO_DATE.test(value)) return { ok: true, value };
  const match = US_DATE.exec(value);
  if (match) {
    const [, month, day, year] = match;
    return {
      ok: true,
      value: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
    };
  }
  return { ok: false };
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
