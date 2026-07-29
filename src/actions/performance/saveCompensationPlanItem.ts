"use server";

import { and, eq } from "drizzle-orm";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import {
  type CompensationPlanItem,
  compensationPlanItem,
  staffEmployment,
} from "@/lib/db/schema";
import { COMPENSATION_PLAN_ACCESS } from "@/lib/performance/compensation-plan";
import { sanitizeSubratings } from "@/lib/performance/rating-rubric";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import { requireDraftPlan } from "./compensationPlanWrites";
import { saveCompensationPlanItemSchema } from "./saveCompensationPlanItem.schema";

/**
 * Persist one field-level edit to a plan row. This is the autosave endpoint —
 * it runs on every debounced keystroke, checkbox tick and select change.
 *
 * Only the fields present in `patch` are written, so concurrent edits to
 * different fields of the same row don't clobber each other. Three things are
 * enforced server-side regardless of what the client sends:
 *
 *  - the plan must still be a DRAFT (a co-manager may have committed it);
 *  - the item must belong to the named plan, so an item id from another plan
 *    can't be reached by naming a plan you do have access to;
 *  - subrating keys are re-sanitized against the person's CURRENT role, since
 *    the valid rubric is role-dependent and the role may have changed.
 *
 * Deliberately does NOT `revalidatePath`: invalidating the route on every
 * keystroke would re-render the editor out from under the person typing. The
 * client owns its own state; navigation re-reads.
 */
export const saveCompensationPlanItem = secureActionClient
  .metadata({
    action: "save-compensation-plan-item",
    permission: COMPENSATION_PLAN_ACCESS,
  })
  .inputSchema(saveCompensationPlanItemSchema)
  .action(
    async ({
      parsedInput: { planId, itemId, patch },
    }): Promise<{ ok: true }> => {
      await requireDraftPlan(planId);

      const [item] = await db
        .select({
          id: compensationPlanItem.id,
          staffId: compensationPlanItem.staffId,
          plannedAmount: compensationPlanItem.plannedAmount,
          plannedCurrency: compensationPlanItem.plannedCurrency,
        })
        .from(compensationPlanItem)
        .where(
          and(
            eq(compensationPlanItem.id, itemId),
            eq(compensationPlanItem.planId, planId),
          ),
        )
        .limit(1);

      if (!item) {
        throw new UserSafeActionError(
          "That person is no longer part of this plan.",
        );
      }

      const update: Partial<CompensationPlanItem> = {};

      if ("level" in patch) update.level = patch.level ?? null;
      if ("status" in patch) update.status = patch.status;
      if ("evaluationNotes" in patch) {
        update.evaluationNotes = patch.evaluationNotes ?? null;
      }
      if ("compensationNotes" in patch) {
        update.compensationNotes = patch.compensationNotes ?? null;
      }
      if ("plannedAmount" in patch) {
        update.plannedAmount = patch.plannedAmount ?? null;
      }
      if ("plannedCurrency" in patch) {
        update.plannedCurrency = patch.plannedCurrency ?? null;
      }

      // The role rubric is the authority on which subrating keys are legitimate,
      // and it moves with the person's current employment row — not with whatever
      // the client last rendered.
      if ("subratings" in patch) {
        const [employment] = await db
          .select({ role: staffEmployment.role })
          .from(staffEmployment)
          .where(eq(staffEmployment.staffId, item.staffId))
          .orderBy(...latestEmploymentFirst)
          .limit(1);
        update.subratings = sanitizeSubratings(
          patch.subratings,
          employment?.role ?? null,
        );
      }

      // An amount with no currency is uninterpretable, so refuse to store one.
      // The editor always sends a currency alongside a first amount; this guards
      // the case where it somehow doesn't and the row has none on file either.
      const nextAmount =
        "plannedAmount" in patch ? update.plannedAmount : item.plannedAmount;
      const nextCurrency =
        "plannedCurrency" in patch
          ? update.plannedCurrency
          : item.plannedCurrency;
      if (nextAmount != null && nextCurrency == null) {
        throw new UserSafeActionError(
          "Pick a currency for the planned compensation.",
        );
      }

      await db
        .update(compensationPlanItem)
        .set(update)
        .where(eq(compensationPlanItem.id, itemId));

      return { ok: true };
    },
  );
