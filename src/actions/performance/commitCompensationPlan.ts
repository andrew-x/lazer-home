"use server";

import { eq, type InferInsertModel, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { firstPerKey } from "@/lib/core/collections";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import {
  compensationPlan,
  compensationPlanItem,
  staff,
  staffEmployment,
  staffRating,
} from "@/lib/db/schema";
import {
  COMPENSATION_PLAN_ACCESS,
  currentCompAmount,
} from "@/lib/performance/compensation-plan";
import {
  canonicalSubratings,
  sanitizeSubratings,
} from "@/lib/performance/rating-rubric";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import { latestRatingFirst } from "@/lib/staff/staff-rating-history";
import { commitCompensationPlanSchema } from "./commitCompensationPlan.schema";
import { planPaths, requireDraftPlan } from "./compensationPlanWrites";

type StaffRatingInsert = InferInsertModel<typeof staffRating>;

export type CommitCompensationPlanResult = {
  ratingsWritten: number;
  itemsSnapshotted: number;
};

/**
 * Commit a compensation plan.
 *
 * Two things happen, and it is important which:
 *
 *  1. **Ratings are written.** Each item's proposed level + subratings become a
 *     new dated `staff_rating` row — the person's current rating from here on.
 *  2. **Compensation is NOT written.** Rippling remains the sole writer of
 *     `staff_employment` (ADR 0020). The planned figure stays a proposal; what
 *     commit does instead is freeze a snapshot of what compensation *was*, so the
 *     editor can keep showing a stable before/after and flag any row where the
 *     change has not yet been applied upstream.
 *
 * The rating write reuses the hardening `saveStaffEvaluation` established, for
 * the same reasons: subratings are re-sanitized against each person's current
 * role, no-op rows are dropped so an untouched item doesn't spawn a duplicate
 * rating, inactive/unknown staff are skipped, and the plan's effective date must
 * not predate anyone's latest rating (which would file the new row as history
 * rather than making it current).
 *
 * Committing is one-way and once-only: `requireDraftPlan` rejects a second call.
 */
export const commitCompensationPlan = secureActionClient
  .metadata({
    action: "commit-compensation-plan",
    permission: COMPENSATION_PLAN_ACCESS,
  })
  .inputSchema(commitCompensationPlanSchema)
  .action(
    async ({
      parsedInput: { planId },
      ctx,
    }): Promise<CommitCompensationPlanResult> => {
      const plan = await requireDraftPlan(planId);

      const items = await db
        .select({
          id: compensationPlanItem.id,
          staffId: compensationPlanItem.staffId,
          level: compensationPlanItem.level,
          subratings: compensationPlanItem.subratings,
        })
        .from(compensationPlanItem)
        .where(eq(compensationPlanItem.planId, planId));

      if (items.length === 0) {
        throw new UserSafeActionError(
          "Add at least one person before committing this plan.",
        );
      }

      const staffIds = items.map((item) => item.staffId);

      const [staffRows, ratingRows, employmentRows] = await Promise.all([
        db
          .select({ id: staff.id, name: staff.name, isActive: staff.isActive })
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
            employmentType: staffEmployment.employmentType,
            base: staffEmployment.base,
            hourlyRate: staffEmployment.hourlyRate,
            currency: staffEmployment.currency,
          })
          .from(staffEmployment)
          .where(inArray(staffEmployment.staffId, staffIds))
          .orderBy(...latestEmploymentFirst),
      ]);

      const staffById = new Map(staffRows.map((row) => [row.id, row]));
      const latestRatingByStaff = firstPerKey(ratingRows, (row) => row.staffId);
      const employmentByStaff = firstPerKey(
        employmentRows,
        (row) => row.staffId,
      );

      // Rate known, active staff only. Someone deactivated after being added to
      // the plan is skipped rather than aborting the commit — the rest of the
      // cohort's decisions still land.
      const ratable = items.filter(
        (item) => staffById.get(item.staffId)?.isActive,
      );

      // Sanitize once, so the no-op check and the insert agree on the value.
      const cleanedByItem = new Map(
        ratable.map((item) => [
          item.id,
          sanitizeSubratings(
            item.subratings,
            employmentByStaff.get(item.staffId)?.role ?? null,
          ),
        ]),
      );

      // Drop no-ops: an item is only worth a new rating row if the level OR the
      // subratings actually differ from what the person already has. Untouched
      // rows were seeded from the current rating, so most of a large plan may
      // legitimately write nothing.
      const changed = ratable.filter((item) => {
        const latest = latestRatingByStaff.get(item.staffId);
        return (
          item.level !== (latest?.level ?? null) ||
          canonicalSubratings(cleanedByItem.get(item.id) ?? null) !==
            canonicalSubratings(latest?.subratings ?? null)
        );
      });

      // A new dated row must not predate the person's latest rating, or it files
      // as history and never becomes current. Equal dates are fine (createdAt
      // breaks the tie). Reject rather than skip: the plan's date is editable, so
      // this is actionable, and silently omitting people would be worse.
      const tooEarly = changed
        .filter((item) => {
          const latest = latestRatingByStaff.get(item.staffId);
          return latest != null && plan.effectiveDate < latest.effectiveDate;
        })
        .map((item) => staffById.get(item.staffId)?.name ?? item.staffId);
      if (tooEarly.length > 0) {
        throw new UserSafeActionError(
          `The plan's effective date is before the most recent rating for: ${tooEarly.join(", ")}. Move the plan's date forward and try again.`,
        );
      }

      const ratingInserts: StaffRatingInsert[] = changed.map((item) => ({
        id: generateId("rating"),
        staffId: item.staffId,
        effectiveDate: plan.effectiveDate,
        level: item.level,
        subratings: cleanedByItem.get(item.id) ?? null,
        evaluatedByUserId: ctx.user.id,
      }));

      await db.transaction(async (tx) => {
        if (ratingInserts.length > 0) {
          await tx.insert(staffRating).values(ratingInserts);
        }

        // Freeze what compensation actually was, per item. Tens of rows per plan,
        // so a loop of narrow updates is clearer than one CASE expression — and
        // it's inside the transaction, so the plan can never end up half-frozen.
        for (const item of items) {
          const employment = employmentByStaff.get(item.staffId);
          await tx
            .update(compensationPlanItem)
            .set({
              snapshotAmount: currentCompAmount(employment ?? null),
              snapshotCurrency: employment?.currency ?? null,
              snapshotEmploymentType: employment?.employmentType ?? null,
            })
            .where(eq(compensationPlanItem.id, item.id));
        }

        await tx
          .update(compensationPlan)
          .set({
            status: "COMMITTED",
            committedAt: new Date(),
            committedByUserId: ctx.user.id,
          })
          .where(eq(compensationPlan.id, planId));
      });

      // New levels change the levels dashboard's distribution, the edit-levels
      // grid, and the Compensation dashboard's comp-by-level table. (`/analytics`
      // itself is only a redirect — ADR 0044 — so there is nothing to revalidate.)
      revalidatePath("/analytics/levels");
      revalidatePath("/people/levels");
      revalidatePath("/analytics/compensation");
      for (const path of planPaths(planId)) revalidatePath(path);

      return {
        ratingsWritten: ratingInserts.length,
        itemsSnapshotted: items.length,
      };
    },
  );
