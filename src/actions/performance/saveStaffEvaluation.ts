"use server";

import { type InferInsertModel, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { firstPerKey } from "@/lib/collections";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { staff, staffRating } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { latestRatingFirst } from "@/lib/staff-rating-history";
import { saveStaffEvaluationSchema } from "./saveStaffEvaluation.schema";

type StaffRatingInsert = InferInsertModel<typeof staffRating>;

export type SaveStaffEvaluationResult = { staffAffected: number };

/**
 * Save a staff evaluation: one new dated `staff_rating` row per genuinely-changed
 * staff member. Effective-dated (ADR 0007) — nothing is overwritten, so the level
 * history is preserved.
 *
 * The payload is never trusted: duplicate rows per staff are collapsed (last
 * wins), the current level per staff is re-read here, no-op changes are dropped,
 * unknown/now-inactive targets are silently skipped (so one stale row can't abort
 * the batch), and the effective date must not predate a staff member's latest
 * rating. Gated by `ratings.edit` (manager/admin) via metadata — enforced before
 * the body.
 */
export const saveStaffEvaluation = secureActionClient
  .metadata({
    action: "save-staff-evaluation",
    permission: { ratings: ["edit"] },
  })
  .inputSchema(saveStaffEvaluationSchema)
  .action(
    async ({
      parsedInput: { effectiveDate, changes },
      ctx,
    }): Promise<SaveStaffEvaluationResult> => {
      // Default the evaluation date to today (wall-clock ISO date), matching
      // `commitStaffImport`. Callers may pass one, but the UI never does.
      const evaluatedOn =
        effectiveDate ?? new Date().toISOString().slice(0, 10);

      // Collapse duplicate rows for the same staff (last wins) so a crafted
      // payload can't insert two same-dated rows and make "current" ambiguous
      // (identical effectiveDate + same-transaction createdAt can't be tiebroken).
      const deduped = [...new Map(changes.map((c) => [c.staffId, c])).values()];
      const staffIds = deduped.map((c) => c.staffId);

      // Re-read the targets (active only) and each one's latest rating row. Names
      // give readable errors; the latest level lets us drop no-ops.
      const [staffRows, ratingRows] = await Promise.all([
        db
          .select({
            id: staff.id,
            name: staff.name,
            isActive: staff.isActive,
          })
          .from(staff)
          .where(inArray(staff.id, staffIds)),
        db
          .select({
            staffId: staffRating.staffId,
            level: staffRating.level,
            effectiveDate: staffRating.effectiveDate,
          })
          .from(staffRating)
          .where(inArray(staffRating.staffId, staffIds))
          .orderBy(...latestRatingFirst),
      ]);

      const staffById = new Map(staffRows.map((s) => [s.id, s]));
      const labelFor = (staffId: string) =>
        staffById.get(staffId)?.name ?? staffId;
      const latestByStaff = firstPerKey(ratingRows, (row) => row.staffId);

      // Only rate known, active staff. A target deactivated between page load
      // and save (or an unknown id) is silently skipped rather than failing the
      // whole batch — a manager's other edits still land.
      const targets = deduped.filter((c) => staffById.get(c.staffId)?.isActive);

      // Drop no-ops: same level as the person's current level (null = unrated).
      const effective = targets.filter((change) => {
        const current = latestByStaff.get(change.staffId)?.level ?? null;
        return change.level !== current;
      });

      if (effective.length === 0) return { staffAffected: 0 };

      // A new dated row must not predate the staff's latest rating (which would
      // make it a non-current historical row). Equal dates are fine — the
      // createdAt tiebreak (latestRatingFirst) makes the newer write current.
      const tooEarly = effective
        .filter((c) => {
          const latest = latestByStaff.get(c.staffId);
          return latest != null && evaluatedOn < latest.effectiveDate;
        })
        .map((c) => labelFor(c.staffId));
      if (tooEarly.length > 0) {
        throw new UserSafeActionError(
          `Evaluation date must be on or after the most recent rating for: ${tooEarly.join(", ")}.`,
        );
      }

      const rows: StaffRatingInsert[] = effective.map((c) => ({
        id: generateId("rating"),
        staffId: c.staffId,
        effectiveDate: evaluatedOn,
        level: c.level,
        evaluatedByUserId: ctx.user.id,
      }));

      // A single multi-row insert is already atomic — no transaction needed.
      await db.insert(staffRating).values(rows);

      // The Levels section lives on the main /performance dashboard now.
      revalidatePath("/performance");
      revalidatePath("/performance/levels/edit");

      return { staffAffected: effective.length };
    },
  );
