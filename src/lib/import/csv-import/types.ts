/**
 * Shared shapes for the admin CSV imports (staff, PTO). These are consumed by
 * both the client (CSV parse + transform, preview tables) and the server
 * (diff + persist), so this module must stay free of server-only imports.
 */

/** A raw parsed CSV row keyed by header name. */
export type RawRow = Record<string, string | undefined>;

/** A CSV row we couldn't import, surfaced for review (never persisted). */
export type SkippedRow = {
  rowNumber: number;
  name: string;
  ripplingId: string;
  reason: string;
};

/**
 * Result of parsing a date cell: `ok` with a normalized "YYYY-MM-DD" value (or
 * null when the cell was blank), or a parse failure.
 */
export type ParsedDate = { ok: true; value: string | null } | { ok: false };

/** The output of a CSV transform: importable rows plus the ones we skipped. */
export type TransformResult<TRow> = {
  rows: TRow[];
  skipped: SkippedRow[];
};
