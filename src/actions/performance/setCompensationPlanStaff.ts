"use server";

import { and, eq, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { compensationPlanItem } from "@/lib/db/schema";
import { COMPENSATION_PLAN_ACCESS } from "@/lib/performance/compensation-plan";
import {
  buildPlanItems,
  planPaths,
  requireDraftPlan,
} from "./compensationPlanWrites";
import { setCompensationPlanStaffSchema } from "./setCompensationPlanStaff.schema";

export type SetCompensationPlanStaffResult = {
  added: number;
  removed: number;
};

/**
 * Reconcile a draft plan's membership to exactly `staffIds`.
 *
 * One action rather than separate add/remove calls: the membership page submits
 * the whole checked set, so the diff belongs server-side where it can run in a
 * single transaction. Two people editing membership concurrently then land a
 * coherent set rather than interleaving partial adds and removes.
 *
 * People already in the plan are left completely untouched — their proposed
 * rating, figure and notes survive, because only genuinely new ids are inserted
 * and only genuinely absent ones deleted. Removing someone does discard their
 * row, which is why the UI confirms it.
 */
export const setCompensationPlanStaff = secureActionClient
  .metadata({
    action: "set-compensation-plan-staff",
    permission: COMPENSATION_PLAN_ACCESS,
  })
  .inputSchema(setCompensationPlanStaffSchema)
  .action(
    async ({
      parsedInput: { planId, staffIds },
    }): Promise<SetCompensationPlanStaffResult> => {
      await requireDraftPlan(planId);

      const wanted = [...new Set(staffIds)];

      const existing = await db
        .select({ staffId: compensationPlanItem.staffId })
        .from(compensationPlanItem)
        .where(eq(compensationPlanItem.planId, planId));
      const existingIds = new Set(existing.map((row) => row.staffId));

      // Seeded from each person's latest rating and comp currency. Unknown and
      // inactive ids are dropped inside the builder.
      const toInsert = await buildPlanItems(
        planId,
        wanted.filter((staffId) => !existingIds.has(staffId)),
      );

      const removedCount = existing.filter(
        (row) => !wanted.includes(row.staffId),
      ).length;

      if (toInsert.length === 0 && removedCount === 0) {
        return { added: 0, removed: 0 };
      }

      await db.transaction(async (tx) => {
        if (toInsert.length > 0) {
          await tx.insert(compensationPlanItem).values(toInsert);
        }
        if (removedCount > 0) {
          await tx
            .delete(compensationPlanItem)
            .where(
              wanted.length > 0
                ? and(
                    eq(compensationPlanItem.planId, planId),
                    notInArray(compensationPlanItem.staffId, wanted),
                  )
                : eq(compensationPlanItem.planId, planId),
            );
        }
      });

      for (const path of planPaths(planId)) revalidatePath(path);
      revalidatePath(`/people/compensation-plans/${planId}/staff`);

      return { added: toInsert.length, removed: removedCount };
    },
  );
