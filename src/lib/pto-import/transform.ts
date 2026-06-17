import type { NormalizedPto, PtoType, SkippedRow } from "./types";

/**
 * Pure CSV → normalized-PTO transform for the admin import. Runs on the client
 * right after PapaParse, so it stays dependency-free and side-effect free. The
 * derivation rules (status → action/pending, leave policy → type) are documented
 * inline; see docs/domains/staff-profiles.md.
 */

/** A raw parsed CSV row keyed by header name. */
export type RawRow = Record<string, string | undefined>;

export type TransformResult = {
  rows: NormalizedPto[];
  skipped: SkippedRow[];
};

const normalizeKey = (key: string) => key.trim().toLowerCase();

/** Read a column by header name, tolerant of surrounding whitespace/casing. */
function getField(row: RawRow, header: string): string {
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

type ParsedDate = { ok: true; value: string | null } | { ok: false };

/** Parse common Rippling date formats to "YYYY-MM-DD"; blank → null. */
function parseDate(input: string): ParsedDate {
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

type Status =
  | { action: "upsert"; isPending: boolean }
  | { action: "delete" }
  | null;

/** Map "Leave request status" to an import action + pending flag. */
function deriveStatus(status: string): Status {
  switch (status.trim().toUpperCase()) {
    case "APPROVED":
      return { action: "upsert", isPending: false };
    case "PENDING":
      return { action: "upsert", isPending: true };
    case "REJECTED":
    case "CANCELED":
    case "CANCELLED":
      return { action: "delete" };
    default:
      return null;
  }
}

/** Map "Leave policy custom name" to a PTO type; null = unrecognized. */
function derivePtoType(policyName: string): PtoType | null {
  const p = policyName.toLowerCase();
  if (p.includes("unlimited vacation")) return "VACATION";
  if (p.includes("family medical leave") || p.includes("sick leave"))
    return "SICK_LEAVE";
  if (p.includes("statutory holiday")) return "STATUTORY_HOLIDAY";
  if (p.includes("company retreat")) return "COMPANY_RETREAT";
  if (p.includes("religious holiday")) return "RELIGIOUS_HOLIDAY";
  if (p.includes("bereavement leave")) return "BEREAVEMENT_LEAVE";
  if (
    p.includes("parental leave") ||
    p.includes("pregnancy leave") ||
    // One-off: this policy name has a double space in the export.
    p.includes("pregnancy  leave") ||
    p.includes("paternity leave")
  )
    return "PARENTAL_LEAVE";
  if (p.includes("jury duty")) return "JURY_DUTY";
  if (p.includes("leave of absence")) return "LEAVE_OF_ABSENCE";
  return null;
}

export function transformRows(rawRows: RawRow[]): TransformResult {
  const rows: NormalizedPto[] = [];
  const skipped: SkippedRow[] = [];
  // Guard against duplicate Leave request IDs in one file: a second create would
  // hit the unique constraint and roll back the entire commit transaction.
  const seenRipplingIds = new Map<string, number>();

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2; // +1 for 0-index, +1 for the header row.
    const ripplingId = getField(raw, "Leave request ID");
    const staffRipplingId = getField(raw, "Employee - ID");
    const name = getField(raw, "Employee");

    const skip = (reason: string) =>
      skipped.push({
        rowNumber,
        name: name || "(unknown)",
        ripplingId,
        reason,
      });

    const missing = [
      !ripplingId && "Leave request ID",
      !staffRipplingId && "Employee - ID",
    ].filter(Boolean) as string[];
    if (missing.length > 0) {
      skip(`Missing required field(s): ${missing.join(", ")}`);
      return;
    }

    const status = deriveStatus(getField(raw, "Leave request status"));
    if (!status) {
      skip(
        `Unrecognized leave request status: "${getField(raw, "Leave request status")}"`,
      );
      return;
    }

    const firstSeenAt = seenRipplingIds.get(ripplingId);
    if (firstSeenAt !== undefined) {
      skip(`Duplicate Leave request ID — first seen at row ${firstSeenAt}`);
      return;
    }
    seenRipplingIds.set(ripplingId, rowNumber);

    // REJECTED/CANCELED: we only need the leave-request id to delete it; skip
    // date/type derivation (a canceled request may have neither).
    if (status.action === "delete") {
      rows.push({
        ripplingId,
        staffRipplingId,
        name,
        action: "delete",
        startDate: null,
        endDate: null,
        type: null,
        isPending: false,
      });
      return;
    }

    const startDate = parseDate(getField(raw, "Start date"));
    if (!startDate.ok || startDate.value === null) {
      skip(
        `Unparseable or missing Start date: "${getField(raw, "Start date")}"`,
      );
      return;
    }
    const endDate = parseDate(getField(raw, "Leave end date"));
    if (!endDate.ok || endDate.value === null) {
      skip(
        `Unparseable or missing Leave end date: "${getField(raw, "Leave end date")}"`,
      );
      return;
    }

    const policyName = getField(raw, "Leave policy custom name");
    const type = derivePtoType(policyName);
    if (!type) {
      skip(`Unrecognized leave type: "${policyName}"`);
      return;
    }

    rows.push({
      ripplingId,
      staffRipplingId,
      name,
      action: "upsert",
      startDate: startDate.value,
      endDate: endDate.value,
      type,
      isPending: status.isPending,
    });
  });

  return { rows, skipped };
}
