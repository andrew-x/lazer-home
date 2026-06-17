"use server";

import { eq, type InferInsertModel, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { publicActionClient } from "@/lib/action";
import { assertLocalhost } from "@/lib/admin";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { staff, staffPto } from "@/lib/db/schema";
import { computePtoImportPlan } from "@/lib/pto-import/plan";
import type { CommitResult } from "@/lib/pto-import/types";
import { ptoImportInputSchema } from "./ptoImport.schema";

type StaffPtoInsert = InferInsertModel<typeof staffPto>;

/** Assert an upsert-row field the transform guaranteed non-null is present. */
function required<T>(value: T | null, field: string): T {
  if (value === null) throw new Error(`PTO import: missing ${field}`);
  return value;
}

/**
 * Persist the PTO import. The plan is recomputed server-side (the client diff is
 * never trusted) and applied in one transaction:
 *   - creates: insert new `staff_pto` rows (staff resolved by Employee - ID)
 *   - updates: set the changed span/type/pending fields, matched by id
 *   - deletes: remove records cancelled/rejected upstream, by leave-request id
 * Localhost-gated; see previewPtoImport for the auth rationale.
 */
export const commitPtoImport = publicActionClient
  .metadata({ action: "commit-pto-import" })
  .inputSchema(ptoImportInputSchema)
  .action(async ({ parsedInput: { rows } }): Promise<CommitResult> => {
    await assertLocalhost();

    const { creates, updates, deletes } = await computePtoImportPlan(rows);

    // Resolve staff ids for the create rows (FK target).
    const createStaffRipplingIds = [
      ...new Set(creates.map((r) => r.staffRipplingId)),
    ];
    const staffRows = createStaffRipplingIds.length
      ? await db
          .select({ id: staff.id, ripplingId: staff.ripplingId })
          .from(staff)
          .where(inArray(staff.ripplingId, createStaffRipplingIds))
      : [];
    const staffIdByRippling = new Map(
      staffRows.map((s) => [s.ripplingId, s.id]),
    );

    const insertRows: StaffPtoInsert[] = creates.map((row) => ({
      id: generateId("staffPto"),
      ripplingId: row.ripplingId,
      staffId: required(
        staffIdByRippling.get(row.staffRipplingId) ?? null,
        `staff for Employee - ID ${row.staffRipplingId}`,
      ),
      startDate: required(row.startDate, "startDate"),
      endDate: required(row.endDate, "endDate"),
      type: required(row.type, "type"),
      isPending: row.isPending,
    }));

    const deleteIds = deletes.map((d) => d.ripplingId);

    await db.transaction(async (tx) => {
      if (insertRows.length > 0) {
        await tx.insert(staffPto).values(insertRows);
      }
      for (const { ptoId, incoming } of updates) {
        await tx
          .update(staffPto)
          .set({
            startDate: required(incoming.startDate, "startDate"),
            endDate: required(incoming.endDate, "endDate"),
            type: required(incoming.type, "type"),
            isPending: incoming.isPending,
            updatedAt: sql`now()`,
          })
          .where(eq(staffPto.id, ptoId));
      }
      if (deleteIds.length > 0) {
        await tx
          .delete(staffPto)
          .where(inArray(staffPto.ripplingId, deleteIds));
      }
    });

    revalidatePath("/");

    return {
      created: creates.length,
      updated: updates.length,
      deleted: deletes.length,
    };
  });
