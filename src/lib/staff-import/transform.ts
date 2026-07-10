import {
  createDuplicateTracker,
  getField,
  isNonEmptyString,
  parseDate,
  parseNumber,
  type RawRow,
  type TransformResult,
} from "@/lib/csv-import";
import { normalizeCurrency } from "@/lib/currency";
import { normalizeEmploymentFacts } from "@/lib/employment";
import type {
  EmploymentType,
  LineOfBusiness,
  NormalizedStaff,
  Role,
} from "./types";

/**
 * Pure CSV → normalized-staff transform for the admin import. Runs on the
 * client right after PapaParse, so it stays dependency-free and side-effect
 * free. The derivation rules (line of business, role, type, billability) are
 * documented inline; see docs/domains/staff-profiles.md. Shared parse
 * primitives live in `@/lib/csv-import`.
 */

// Roles that are not billable. Everyone else (Engineer, Designer, Architect,
// Delivery, QA) is billable.
const NON_BILLABLE_ROLES = new Set<Role>([
  "LEADERSHIP",
  "SALES",
  "SOLUTIONS",
  "OPERATIONS",
]);

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

export function transformRows(
  rawRows: RawRow[],
): TransformResult<NormalizedStaff> {
  const rows: NormalizedStaff[] = [];
  const skipped: TransformResult<NormalizedStaff>["skipped"] = [];
  const seenRipplingIds = createDuplicateTracker();

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
    ].filter(isNonEmptyString);
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

    const firstSeenAt = seenRipplingIds.firstSeenAt(ripplingId, rowNumber);
    if (firstSeenAt !== null) {
      skip(`Duplicate Rippling ID — first seen at row ${firstSeenAt}`);
      return;
    }

    // Compensation is required for staff going forward. Skip any row missing a
    // value (0 is allowed; blank/invalid/negative parses to null). `discretionaryBonus`
    // isn't imported yet, so it defaults to 0.
    const base = parseNumber(getField(raw, "Annual base remuneration"));
    const hourlyRate = parseNumber(getField(raw, "Hourly Rate"));
    const guaranteedBonus = parseNumber(getField(raw, "Target annual bonus"));
    const currency = normalizeCurrency(getField(raw, "Compensation currency"));
    const missingComp = [
      base === null && "Annual base remuneration",
      hourlyRate === null && "Hourly Rate",
      guaranteedBonus === null && "Target annual bonus",
      currency === null && "Compensation currency",
    ].filter(isNonEmptyString);
    // Disjunction (not `missingComp.length`) so TS narrows each value to non-null.
    if (
      base === null ||
      hourlyRate === null ||
      guaranteedBonus === null ||
      currency === null
    ) {
      skip(`Missing/invalid compensation: ${missingComp.join(", ")}`);
      return;
    }

    const role = deriveRole(department, getField(raw, "Title"));
    // Billable staff default to a 100% target; the shared invariant zeroes it
    // for the non-billable roles (single source of truth in `@/lib/employment`).
    const { isBillable, utilizationTarget } = normalizeEmploymentFacts({
      isBillable: !NON_BILLABLE_ROLES.has(role),
      utilizationTarget: 100,
    });

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
      utilizationTarget,
      base,
      hourlyRate,
      guaranteedBonus,
      discretionaryBonus: 0,
      currency,
    });
  });

  return { rows, skipped };
}
