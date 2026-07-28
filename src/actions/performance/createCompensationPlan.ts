"use server";

import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { compensationPlan, compensationPlanItem } from "@/lib/db/schema";
import { COMPENSATION_PLAN_ACCESS } from "@/lib/performance/compensation-plan";
import { buildPlanItems, planPaths } from "./compensationPlanWrites";
import { createCompensationPlanSchema } from "./createCompensationPlan.schema";

/**
 * Create a compensation plan, optionally pre-populated with staff.
 *
 * Returns the new id so the dialog can navigate straight into the editor —
 * with save-on-edit there is nothing to edit until the row exists, so the plan
 * is created first and populated second.
 */
export const createCompensationPlan = secureActionClient
  .metadata({
    action: "create-compensation-plan",
    permission: COMPENSATION_PLAN_ACCESS,
  })
  .inputSchema(createCompensationPlanSchema)
  .action(
    async ({
      parsedInput: { name, effectiveDate, staffIds },
      ctx,
    }): Promise<{ planId: string; staffAdded: number }> => {
      const planId = generateId("cplan");

      const items = await buildPlanItems(planId, staffIds);

      await db.transaction(async (tx) => {
        await tx.insert(compensationPlan).values({
          id: planId,
          name,
          effectiveDate,
          createdByUserId: ctx.user.id,
        });
        if (items.length > 0) {
          await tx.insert(compensationPlanItem).values(items);
        }
      });

      for (const path of planPaths(planId)) revalidatePath(path);

      return { planId, staffAdded: items.length };
    },
  );
