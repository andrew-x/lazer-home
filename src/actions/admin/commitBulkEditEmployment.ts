"use server";

import { desc, eq, type InferInsertModel, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { publicActionClient } from "@/lib/action";
import { assertLocalhost } from "@/lib/admin";
import { firstPerKey } from "@/lib/collections";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { staff, staffEmployment } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import {
  bulkEditEmploymentSchema,
  FACT_FIELDS,
} from "./bulkEditEmployment.schema";

type StaffEmploymentInsert = InferInsertModel<typeof staffEmployment>;

export type BulkEditEmploymentResult = {
  staffAffected: number;
  mode: "update" | "insert";
};

/**
 * Apply a bulk edit of staff employment facts in one transaction.
 *
 * The payload is never trusted: the latest employment row per staff is re-read
 * here, no-op changes are dropped, and the effective-date rule is re-validated.
 *
 *   - `effectiveDate` blank → correct each staff's latest employment row in
 *     place (no new historical fact).
 *   - `effectiveDate` set → insert a new effective-dated row per staff; the date
 *     must be strictly after that staff's latest effective date.
 *
 * This in-place-update path deliberately extends ADR 0007 (which otherwise only
 * inserts new rows). Localhost-gated; see staff import for the auth rationale.
 */
export const commitBulkEditEmployment = publicActionClient
  .metadata({ action: "bulk-edit-employment" })
  .inputSchema(bulkEditEmploymentSchema)
  .action(
    async ({
      parsedInput: { effectiveDate, changes },
    }): Promise<BulkEditEmploymentResult> => {
      await assertLocalhost();

      const staffIds = changes.map((c) => c.staffId);

      // Latest employment row per affected staff (effectiveFromDate desc,
      // createdAt desc — ADR 0007). Plus names for readable error messages.
      const [employmentRows, nameRows] = await Promise.all([
        db
          .select({
            id: staffEmployment.id,
            staffId: staffEmployment.staffId,
            effectiveFromDate: staffEmployment.effectiveFromDate,
            lineOfBusiness: staffEmployment.lineOfBusiness,
            role: staffEmployment.role,
            employmentType: staffEmployment.employmentType,
            isBillable: staffEmployment.isBillable,
            utilizationTarget: staffEmployment.utilizationTarget,
            billableType: staffEmployment.billableType,
            isManagement: staffEmployment.isManagement,
            // Comp isn't editable here (import-only); read it so a new inserted row
            // carries it forward instead of clearing it.
            base: staffEmployment.base,
            hourlyRate: staffEmployment.hourlyRate,
            guaranteedBonus: staffEmployment.guaranteedBonus,
            discretionaryBonus: staffEmployment.discretionaryBonus,
            currency: staffEmployment.currency,
          })
          .from(staffEmployment)
          .where(inArray(staffEmployment.staffId, staffIds))
          .orderBy(
            desc(staffEmployment.effectiveFromDate),
            desc(staffEmployment.createdAt),
          ),
        db
          .select({ id: staff.id, name: staff.name })
          .from(staff)
          .where(inArray(staff.id, staffIds)),
      ]);

      const latestByStaff = firstPerKey(employmentRows, (row) => row.staffId);
      const nameById = new Map(nameRows.map((s) => [s.id, s.name]));
      const labelFor = (staffId: string) => nameById.get(staffId) ?? staffId;

      // Drop no-ops and verify each staff resolves to an employment row.
      const missing: string[] = [];
      const effective = changes.filter((change) => {
        const latest = latestByStaff.get(change.staffId);
        if (!latest) {
          missing.push(labelFor(change.staffId));
          return false;
        }
        return FACT_FIELDS.some((f) => change[f] !== latest[f]);
      });

      if (missing.length > 0) {
        throw new UserSafeActionError(
          `No employment record found for: ${missing.join(", ")}.`,
        );
      }

      // Re-assert the billable/target invariant server-side (the Zod refine is
      // the UI's guard; this protects against a crafted payload).
      const badTarget = effective
        .filter((c) => !c.isBillable && c.utilizationTarget !== 0)
        .map((c) => labelFor(c.staffId));
      if (badTarget.length > 0) {
        throw new UserSafeActionError(
          `Utilization target must be 0 when not billable for: ${badTarget.join(", ")}.`,
        );
      }

      if (effective.length === 0) {
        return { staffAffected: 0, mode: effectiveDate ? "insert" : "update" };
      }

      // A new effective-dated row must postdate the staff's latest row.
      if (effectiveDate) {
        const tooEarly = effective
          .filter((c) => {
            const latest = latestByStaff.get(c.staffId);
            return latest != null && effectiveDate <= latest.effectiveFromDate;
          })
          .map((c) => labelFor(c.staffId));
        if (tooEarly.length > 0) {
          throw new UserSafeActionError(
            `Effective date must be after the most recent employment record for: ${tooEarly.join(", ")}.`,
          );
        }
      }

      await db.transaction(async (tx) => {
        if (effectiveDate) {
          const rows: StaffEmploymentInsert[] = effective.map((c) => {
            // Carry comp forward from the latest row — it isn't part of the edit.
            const latest = latestByStaff.get(c.staffId);
            return {
              id: generateId("staffEmployment"),
              staffId: c.staffId,
              effectiveFromDate: effectiveDate,
              lineOfBusiness: c.lineOfBusiness,
              role: c.role,
              employmentType: c.employmentType,
              isBillable: c.isBillable,
              utilizationTarget: c.utilizationTarget,
              billableType: c.billableType,
              isManagement: c.isManagement,
              // `latest` is guaranteed present (missing rows were filtered out);
              // comp is NOT NULL, so carry it forward as-is.
              base: latest?.base ?? 0,
              hourlyRate: latest?.hourlyRate ?? 0,
              guaranteedBonus: latest?.guaranteedBonus ?? 0,
              discretionaryBonus: latest?.discretionaryBonus ?? 0,
              currency: latest?.currency ?? "CAD",
            };
          });
          await tx.insert(staffEmployment).values(rows);
        } else {
          // In-place correction of the latest row (updatedAt via $onUpdate).
          for (const c of effective) {
            const latest = latestByStaff.get(c.staffId);
            if (!latest) continue;
            await tx
              .update(staffEmployment)
              .set({
                lineOfBusiness: c.lineOfBusiness,
                role: c.role,
                employmentType: c.employmentType,
                isBillable: c.isBillable,
                utilizationTarget: c.utilizationTarget,
                billableType: c.billableType,
                isManagement: c.isManagement,
              })
              .where(eq(staffEmployment.id, latest.id));
          }
        }
      });

      revalidatePath("/");

      return {
        staffAffected: effective.length,
        mode: effectiveDate ? "insert" : "update",
      };
    },
  );
