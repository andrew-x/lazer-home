import "server-only";
import { desc, inArray } from "drizzle-orm";
import { firstPerKey } from "@/lib/collections";
import { db } from "@/lib/db/db";
import { staff, staffEmployment } from "@/lib/db/schema";
import {
  type ComparableField,
  type ComparableSnapshot,
  EMPLOYMENT_FIELDS,
  IDENTITY_FIELDS,
  type ImportUpdate,
  type NormalizedStaff,
  type StaffImportPlan,
} from "./types";

/**
 * Diff the incoming (already-transformed) rows against the database, splitting
 * them into creates and updates. Matching is by `ripplingId`. For updates we
 * compute which comparable fields changed (for table marking) and whether any
 * employment fact changed (which drives a new effective-dated employment row on
 * commit — see ADR 0007).
 */
export async function computeImportPlan(
  rows: NormalizedStaff[],
): Promise<StaffImportPlan> {
  const ripplingIds = rows.map((r) => r.ripplingId);

  const existing = ripplingIds.length
    ? await db
        .select({
          id: staff.id,
          ripplingId: staff.ripplingId,
          name: staff.name,
          email: staff.email,
          joinDate: staff.joinDate,
          terminationDate: staff.terminationDate,
          isActive: staff.isActive,
        })
        .from(staff)
        .where(inArray(staff.ripplingId, ripplingIds))
    : [];

  const existingByRippling = new Map(existing.map((s) => [s.ripplingId, s]));

  // Latest employment row per matched staff (highest effectiveFromDate wins;
  // createdAt breaks ties for same-day changes).
  const staffIds = existing.map((s) => s.id);
  const employments = staffIds.length
    ? await db
        .select({
          staffId: staffEmployment.staffId,
          lineOfBusiness: staffEmployment.lineOfBusiness,
          role: staffEmployment.role,
          employmentType: staffEmployment.employmentType,
          isBillable: staffEmployment.isBillable,
          utilizationTarget: staffEmployment.utilizationTarget,
          isManagement: staffEmployment.isManagement,
          billableType: staffEmployment.billableType,
        })
        .from(staffEmployment)
        .where(inArray(staffEmployment.staffId, staffIds))
        .orderBy(
          desc(staffEmployment.effectiveFromDate),
          desc(staffEmployment.createdAt),
        )
    : [];

  const latestEmploymentByStaff = firstPerKey(employments, (e) => e.staffId);

  const creates: NormalizedStaff[] = [];
  const updates: ImportUpdate[] = [];
  let unchanged = 0;

  for (const incoming of rows) {
    const match = existingByRippling.get(incoming.ripplingId);
    if (!match) {
      creates.push(incoming);
      continue;
    }

    const employment = latestEmploymentByStaff.get(match.id) ?? null;
    const current: ComparableSnapshot = {
      name: match.name,
      email: match.email,
      joinDate: match.joinDate,
      terminationDate: match.terminationDate,
      isActive: match.isActive,
      lineOfBusiness: employment?.lineOfBusiness ?? null,
      role: employment?.role ?? null,
      employmentType: employment?.employmentType ?? null,
      isBillable: employment?.isBillable ?? null,
      utilizationTarget: employment?.utilizationTarget ?? null,
      isManagement: employment?.isManagement ?? null,
      billableType: employment?.billableType ?? null,
    };

    // LEADERSHIP is assigned manually (promotions), never via import — so for
    // someone already in LEADERSHIP we preserve their role and its billability
    // rather than overwriting it from the CSV-derived role. (`isManagement` is
    // likewise import-preserved, but for everyone — carried forward at commit.)
    const effective: NormalizedStaff =
      current.role === "LEADERSHIP"
        ? {
            ...incoming,
            role: "LEADERSHIP",
            isBillable: current.isBillable ?? false,
            utilizationTarget: current.utilizationTarget ?? 0,
          }
        : incoming;

    const changedFields: ComparableField[] = [];
    for (const field of [...IDENTITY_FIELDS, ...EMPLOYMENT_FIELDS]) {
      if (effective[field] !== current[field]) changedFields.push(field);
    }

    // Identical to the existing record — nothing to write.
    if (changedFields.length === 0) {
      unchanged += 1;
      continue;
    }

    const employmentChanged = EMPLOYMENT_FIELDS.some(
      (field) => effective[field] !== current[field],
    );

    updates.push({
      staffId: match.id,
      incoming: effective,
      current,
      changedFields,
      employmentChanged,
    });
  }

  return { creates, updates, unchanged };
}
