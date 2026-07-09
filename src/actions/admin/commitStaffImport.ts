"use server";

import { type InferInsertModel, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { publicActionClient } from "@/lib/action";
import { assertLocalhost } from "@/lib/admin";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { staff, staffEmployment } from "@/lib/db/schema";
import { computeImportPlan } from "@/lib/staff-import/plan";
import type { CommitResult } from "@/lib/staff-import/types";
import { staffImportInputSchema } from "./staffImport.schema";

type StaffInsert = InferInsertModel<typeof staff>;
type StaffEmploymentInsert = InferInsertModel<typeof staffEmployment>;

/**
 * Persist the import. The plan is recomputed server-side (the client diff is
 * never trusted) and applied in one transaction with batched statements:
 *   - a single upsert into `staff` — creates insert, updates conflict on `id`
 *     and set only the identity fields (ADR 0007: employment facts live in
 *     `staff_employment`, never updated in place)
 *   - a single batched insert into `staff_employment` — an initial row per
 *     create (effective on join) and a new effective-dated row per update whose
 *     employment facts changed (effective today)
 * Localhost-gated; see previewStaffImport for the auth rationale.
 */
export const commitStaffImport = publicActionClient
  .metadata({ action: "commit-staff-import" })
  .inputSchema(staffImportInputSchema)
  .action(async ({ parsedInput: { rows } }): Promise<CommitResult> => {
    await assertLocalhost();

    const { creates, updates } = await computeImportPlan(rows);
    const today = new Date().toISOString().slice(0, 10);

    const staffRows: StaffInsert[] = [];
    const employmentRows: StaffEmploymentInsert[] = [];

    for (const row of creates) {
      const staffId = generateId("staff");
      staffRows.push({
        id: staffId,
        ripplingId: row.ripplingId,
        name: row.name,
        email: row.email,
        joinDate: row.joinDate,
        terminationDate: row.terminationDate,
        isActive: row.isActive,
      });
      employmentRows.push({
        id: generateId("staffEmployment"),
        staffId,
        effectiveFromDate: row.joinDate ?? today,
        lineOfBusiness: row.lineOfBusiness,
        role: row.role,
        employmentType: row.employmentType,
        isBillable: row.isBillable,
        utilizationTarget: row.utilizationTarget,
        base: row.base,
        hourlyRate: row.hourlyRate,
        guaranteedBonus: row.guaranteedBonus,
        discretionaryBonus: row.discretionaryBonus,
        currency: row.currency,
      });
    }

    for (const { staffId, incoming, current, employmentChanged } of updates) {
      staffRows.push({
        id: staffId,
        ripplingId: incoming.ripplingId,
        name: incoming.name,
        email: incoming.email,
        joinDate: incoming.joinDate,
        terminationDate: incoming.terminationDate,
        isActive: incoming.isActive,
      });
      if (employmentChanged) {
        employmentRows.push({
          id: generateId("staffEmployment"),
          staffId,
          effectiveFromDate: today,
          lineOfBusiness: incoming.lineOfBusiness,
          role: incoming.role,
          employmentType: incoming.employmentType,
          isBillable: incoming.isBillable,
          utilizationTarget: incoming.utilizationTarget,
          // Comp is required on every import row.
          base: incoming.base,
          hourlyRate: incoming.hourlyRate,
          guaranteedBonus: incoming.guaranteedBonus,
          discretionaryBonus: incoming.discretionaryBonus,
          currency: incoming.currency,
          // isManagement and billableType aren't CSV facts — carry the current
          // values forward so a role/LoB change never silently resets them.
          isManagement: current.isManagement ?? false,
          billableType: current.billableType ?? "HUB",
        });
      }
    }

    await db.transaction(async (tx) => {
      if (staffRows.length > 0) {
        await tx
          .insert(staff)
          .values(staffRows)
          .onConflictDoUpdate({
            target: staff.id,
            // Identity fields only — take the incoming values from `excluded`.
            set: {
              name: sql`excluded.name`,
              email: sql`excluded.email`,
              joinDate: sql`excluded.join_date`,
              terminationDate: sql`excluded.termination_date`,
              isActive: sql`excluded.is_active`,
              updatedAt: sql`now()`,
            },
          });
      }
      if (employmentRows.length > 0) {
        await tx.insert(staffEmployment).values(employmentRows);
      }
    });

    revalidatePath("/");

    return {
      created: creates.length,
      updated: updates.length,
      employmentRowsAdded: employmentRows.length,
    };
  });
