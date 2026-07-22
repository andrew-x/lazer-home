import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { staff, staffPto } from "@/lib/db/schema";
import {
  type ComparableField,
  type ComparableSnapshot,
  type NormalizedPto,
  PTO_FIELDS,
  type PtoImportPlan,
  type PtoImportUpdate,
} from "./types";

/**
 * Diff the incoming (already-transformed) PTO rows against the database.
 * Matching is two-level: a row's "Employee - ID" resolves a staff member
 * (`staff.ripplingId`); the row itself matches an existing PTO record by its
 * "Leave request ID" (`staffPto.ripplingId`).
 *
 * `upsert` rows split into creates / updates / unchanged; `delete` rows
 * (REJECTED/CANCELED upstream) become deletes when a record exists, else they
 * are counted as ignored. Upsert rows whose employee id resolves to no staff
 * are surfaced as `unresolved` (we can't insert a PTO row without a staff FK).
 */
export async function computePtoImportPlan(
  rows: NormalizedPto[],
): Promise<PtoImportPlan> {
  // Resolve staff by employee (Rippling) id.
  const staffRipplingIds = [...new Set(rows.map((r) => r.staffRipplingId))];
  const staffRows = staffRipplingIds.length
    ? await db
        .select({
          id: staff.id,
          ripplingId: staff.ripplingId,
          name: staff.name,
        })
        .from(staff)
        .where(inArray(staff.ripplingId, staffRipplingIds))
    : [];
  const staffByRippling = new Map(staffRows.map((s) => [s.ripplingId, s]));

  // Existing PTO records keyed by leave-request id.
  const ripplingIds = rows.map((r) => r.ripplingId);
  const existing = ripplingIds.length
    ? await db
        .select({
          id: staffPto.id,
          ripplingId: staffPto.ripplingId,
          startDate: staffPto.startDate,
          endDate: staffPto.endDate,
          type: staffPto.type,
          isPending: staffPto.isPending,
        })
        .from(staffPto)
        .where(inArray(staffPto.ripplingId, ripplingIds))
    : [];
  const existingByRippling = new Map(existing.map((p) => [p.ripplingId, p]));

  const creates: NormalizedPto[] = [];
  const updates: PtoImportUpdate[] = [];
  const plan: PtoImportPlan = {
    creates,
    updates,
    deletes: [],
    unchanged: 0,
    ignoredCancellations: 0,
  };

  for (const incoming of rows) {
    const match = existingByRippling.get(incoming.ripplingId);

    if (incoming.action === "delete") {
      if (match) {
        plan.deletes.push({
          ripplingId: match.ripplingId,
          staffName:
            staffByRippling.get(incoming.staffRipplingId)?.name ||
            incoming.name ||
            "(unknown)",
          startDate: match.startDate,
          endDate: match.endDate,
          type: match.type,
        });
      } else {
        plan.ignoredCancellations += 1;
      }
      continue;
    }

    // upsert: the staff member must exist (FK target). Silently ignore rows
    // whose Employee - ID matches no staff (e.g. contractors / ex-staff not in
    // the staff table) — they're neither imported nor surfaced.
    if (!staffByRippling.has(incoming.staffRipplingId)) {
      continue;
    }

    if (!match) {
      creates.push(incoming);
      continue;
    }

    const current: ComparableSnapshot = {
      startDate: match.startDate,
      endDate: match.endDate,
      type: match.type,
      isPending: match.isPending,
    };

    const changedFields: ComparableField[] = [];
    for (const field of PTO_FIELDS) {
      if (incoming[field] !== current[field]) changedFields.push(field);
    }

    if (changedFields.length === 0) {
      plan.unchanged += 1;
      continue;
    }

    updates.push({
      ptoId: match.id,
      incoming,
      current,
      changedFields,
    });
  }

  return plan;
}
