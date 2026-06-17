import type {
  EmploymentType,
  LineOfBusiness,
  NormalizedStaff,
  Role,
  SkippedRow,
} from "./types";

/**
 * Pure CSV → normalized-staff transform for the admin import. Runs on the
 * client right after PapaParse, so it stays dependency-free and side-effect
 * free. The derivation rules (line of business, role, type, billability) are
 * documented inline; see docs/domains/staff-profiles.md.
 */

/** A raw parsed CSV row keyed by header name. */
export type RawRow = Record<string, string | undefined>;

export type TransformResult = {
  rows: NormalizedStaff[];
  skipped: SkippedRow[];
};

// Roles that are not billable. Everyone else (Engineer, Designer, Architect,
// Delivery, QA) is billable.
const NON_BILLABLE_ROLES = new Set<Role>([
  "LEADERSHIP",
  "SALES",
  "SOLUTIONS",
  "OPERATIONS",
]);

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

/** Department "Design" → DESIGN; otherwise derive from the Teams column. */
function deriveLineOfBusiness(
  department: string,
  teams: string,
): LineOfBusiness | null {
  if (department.toLowerCase() === "design") return "DESIGN";
  const t = teams.toLowerCase();
  if (t.includes("core")) return "CORE";
  if (t.includes("commerce")) return "COMMERCE";
  if (t.includes("corporate")) return "CORPORATE";
  if (t.includes("fintech") || t.includes("crypto")) return "FINTECH";
  return null;
}

/** Department first, then Title keywords; falls back to Operations. */
function deriveRole(department: string, title: string): Role {
  const d = department.toLowerCase();
  const t = title.toLowerCase();
  if (d === "design") return "DESIGNER";
  if (d === "talent") return "OPERATIONS";
  if (d === "sales") return "SALES";
  if (d === "solutioning") return "SOLUTIONS";
  if (t.includes("delivery")) return "DELIVERY";
  if (t.includes("architect")) return "ARCHITECT";
  if (t.includes("qa")) return "QA";
  if (t.includes("engineer")) return "ENGINEER";
  return "OPERATIONS";
}

function deriveEmploymentType(employmentTypeName: string): EmploymentType {
  return employmentTypeName.toLowerCase().includes("hourly")
    ? "HOURLY"
    : "FULL_TIME";
}

export function transformRows(rawRows: RawRow[]): TransformResult {
  const rows: NormalizedStaff[] = [];
  const skipped: SkippedRow[] = [];
  // Guard against duplicate Rippling IDs in one file: a second create would hit
  // the unique constraint and roll back the entire commit transaction.
  const seenRipplingIds = new Map<string, number>();

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2; // +1 for 0-index, +1 for the header row.
    const ripplingId = getField(raw, "Employee - ID");
    const name = getField(raw, "Employee");
    const email = getField(raw, "Work email");

    const skip = (reason: string) =>
      skipped.push({
        rowNumber,
        name: name || "(unknown)",
        ripplingId,
        reason,
      });

    const missing = [
      !ripplingId && "Employee - ID",
      !name && "Employee",
      !email && "Work email",
    ].filter(Boolean) as string[];
    if (missing.length > 0) {
      skip(`Missing required field(s): ${missing.join(", ")}`);
      return;
    }

    const joinDate = parseDate(getField(raw, "Start date"));
    if (!joinDate.ok) {
      skip(`Unparseable Start date: "${getField(raw, "Start date")}"`);
      return;
    }
    const terminationDate = parseDate(getField(raw, "Last day of work"));
    if (!terminationDate.ok) {
      skip(
        `Unparseable Last day of work: "${getField(raw, "Last day of work")}"`,
      );
      return;
    }

    const department = getField(raw, "Department");
    const teams = getField(raw, "Teams");
    const lineOfBusiness = deriveLineOfBusiness(department, teams);
    if (!lineOfBusiness) {
      skip(
        `Could not map line of business (Department="${department}", Teams="${teams}")`,
      );
      return;
    }

    const firstSeenAt = seenRipplingIds.get(ripplingId);
    if (firstSeenAt !== undefined) {
      skip(`Duplicate Rippling ID — first seen at row ${firstSeenAt}`);
      return;
    }
    seenRipplingIds.set(ripplingId, rowNumber);

    const role = deriveRole(department, getField(raw, "Title"));
    const isBillable = !NON_BILLABLE_ROLES.has(role);

    rows.push({
      ripplingId,
      name,
      email,
      joinDate: joinDate.value,
      terminationDate: terminationDate.value,
      isActive: terminationDate.value === null,
      lineOfBusiness,
      role,
      employmentType: deriveEmploymentType(
        getField(raw, "Employment type name"),
      ),
      isBillable,
      utilizationTarget: isBillable ? 100 : 0,
    });
  });

  return { rows, skipped };
}
