"use server";

import { type InferInsertModel, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { localActionClient } from "@/lib/action";
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
 *     `staff_employment`, never updated in place). `managerId` is an identity
 *     fact, resolved below and set through the same upsert.
 *   - a single batched insert into `staff_employment` — an initial row per
 *     create (effective on join) and a new effective-dated row per update whose
 *     employment facts changed (effective today)
 *
 * Managers are matched by email in the plan and carried as a stable manager
 * `ripplingId`; here we resolve those to `staff.id`. The map spans this batch's
 * creates (freshly minted ids), its updates, and any managers that live only in
 * the DB. Because creates + updates share one `insert(staff)` statement,
 * Postgres verifies the self-FK at statement end, so intra-batch references
 * (A managed by B, both new) resolve fine.
 * Localhost-gated; see previewStaffImport for the auth rationale.
 */
export const commitStaffImport = localActionClient
  .metadata({ action: "commit-staff-import" })
  .inputSchema(staffImportInputSchema)
  .action(async ({ parsedInput: { rows } }): Promise<CommitResult> => {
    const { creates, updates } = await computeImportPlan(rows);
    const today = new Date().toISOString().slice(0, 10);

    const staffRows: StaffInsert[] = [];
    const employmentRows: StaffEmploymentInsert[] = [];

    // ripplingId → staffId for everyone written this batch, and each row's
    // manager reference (a ripplingId) to resolve once the map is complete.
    const idByRippling = new Map<string, string>();
    const managerRefByRippling = new Map<string, string | null>();

    for (const { incoming: row, managerRipplingId } of creates) {
      const staffId = generateId("staff");
      idByRippling.set(row.ripplingId, staffId);
      managerRefByRippling.set(row.ripplingId, managerRipplingId);
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

    for (const {
      staffId,
      incoming,
      current,
      employmentChanged,
      managerRipplingId,
    } of updates) {
      idByRippling.set(incoming.ripplingId, staffId);
      managerRefByRippling.set(incoming.ripplingId, managerRipplingId);
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

    // Managers that resolved to someone outside this batch (existing DB staff).
    const referencedManagers = [
      ...new Set(
        [...managerRefByRippling.values()].filter((r): r is string => !!r),
      ),
    ];
    const externalManagers = referencedManagers.filter(
      (r) => !idByRippling.has(r),
    );
    if (externalManagers.length > 0) {
      const dbManagers = await db
        .select({ id: staff.id, ripplingId: staff.ripplingId })
        .from(staff)
        .where(inArray(staff.ripplingId, externalManagers));
      for (const m of dbManagers) idByRippling.set(m.ripplingId, m.id);
    }

    // Resolve each row's manager ripplingId → staffId now the map is complete.
    for (const row of staffRows) {
      const ref = managerRefByRippling.get(row.ripplingId) ?? null;
      row.managerId = ref ? (idByRippling.get(ref) ?? null) : null;
    }

    // "Linked" = relationships established or changed this import: every create
    // that got a manager, plus updates whose manager actually changed to a
    // non-null value. A cleared link or an unchanged pointer carried past an
    // unrelated field change doesn't count.
    const managersLinked =
      creates.filter((c) => c.managerRipplingId).length +
      updates.filter((u) => u.managerChanged && u.managerRipplingId).length;

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
              managerId: sql`excluded.manager_id`,
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
      managersLinked,
    };
  });
