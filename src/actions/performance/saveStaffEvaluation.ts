"use server";

import { type InferInsertModel, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { firstPerKey } from "@/lib/core/collections";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { staff, staffEmployment, staffRating } from "@/lib/db/schema";
import {
  canonicalSubratings,
  type Subratings,
  sanitizeSubratings,
} from "@/lib/performance/rating-rubric";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import { latestRatingFirst } from "@/lib/staff/staff-rating-history";
import { saveStaffEvaluationSchema } from "./saveStaffEvaluation.schema";

type StaffRatingInsert = InferInsertModel<typeof staffRating>;

export type SaveStaffEvaluationResult = { staffAffected: number };

/**
 * Save a staff evaluation: one new dated `staff_rating` row per genuinely-changed
 * staff member. Effective-dated (ADR 0007) — nothing is overwritten, so the level
 * history is preserved.
 *
 * Each row carries the overall level AND per-role subratings, kept together so
 * the subrating history is dated exactly like the level.
 *
 * The payload is never trusted: duplicate rows per staff are collapsed (last
 * wins), the current level + subratings per staff are re-read here, no-op changes
 * are dropped (level and subratings must both match to skip), subrating keys are
 * sanitized against the person's current-role rubric, unknown/now-inactive
 * targets are silently skipped (so one stale row can't abort the batch), and the
 * effective date must not predate a staff member's latest rating. Gated by
 * `ratings.edit` (manager/admin) via metadata — enforced before the body.
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

      // Re-read the targets (active only), each one's latest rating row, and
      // their current role. Names give readable errors; the latest level +
      // subratings let us drop no-ops; the role validates which subrating keys
      // are legitimate for the person.
      const [staffRows, ratingRows, employmentRows] = await Promise.all([
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
            subratings: staffRating.subratings,
            effectiveDate: staffRating.effectiveDate,
          })
          .from(staffRating)
          .where(inArray(staffRating.staffId, staffIds))
          .orderBy(...latestRatingFirst),
        db
          .select({
            staffId: staffEmployment.staffId,
            role: staffEmployment.role,
          })
          .from(staffEmployment)
          .where(inArray(staffEmployment.staffId, staffIds))
          .orderBy(...latestEmploymentFirst),
      ]);

      const staffById = new Map(staffRows.map((s) => [s.id, s]));
      const labelFor = (staffId: string) =>
        staffById.get(staffId)?.name ?? staffId;
      const latestByStaff = firstPerKey(ratingRows, (row) => row.staffId);
      const roleByStaff = firstPerKey(employmentRows, (row) => row.staffId);

      // Only rate known, active staff. A target deactivated between page load
      // and save (or an unknown id) is silently skipped rather than failing the
      // whole batch — a manager's other edits still land.
      const targets = deduped.filter((c) => staffById.get(c.staffId)?.isActive);

      // Sanitize each change's subratings against the person's current-role
      // rubric up front, so both the no-op check and the insert use the same
      // cleaned value (and a payload can't smuggle keys outside the rubric).
      const cleanedByStaff = new Map<string, Subratings | null>(
        targets.map((change) => [
          change.staffId,
          sanitizeSubratings(
            change.subratings,
            roleByStaff.get(change.staffId)?.role ?? null,
          ),
        ]),
      );

      // Drop no-ops: unchanged only when BOTH the overall level (null = unrated)
      // and the subratings (compared by value, key order irrelevant) match the
      // person's current rating.
      const effective = targets.filter((change) => {
        const latest = latestByStaff.get(change.staffId);
        const currentLevel = latest?.level ?? null;
        const currentSubratings = latest?.subratings ?? null;
        const nextSubratings = cleanedByStaff.get(change.staffId) ?? null;
        return (
          change.level !== currentLevel ||
          canonicalSubratings(nextSubratings) !==
            canonicalSubratings(currentSubratings)
        );
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
        subratings: cleanedByStaff.get(c.staffId) ?? null,
        evaluatedByUserId: ctx.user.id,
      }));

      // A single multi-row insert is already atomic — no transaction needed.
      await db.insert(staffRating).values(rows);

      // The Performance dashboard reads levels; its editor lists them.
      revalidatePath("/reporting/levels");
      revalidatePath("/people/levels");

      return { staffAffected: effective.length };
    },
  );
