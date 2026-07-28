"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { compensationPlan } from "@/lib/db/schema";
import { COMPENSATION_PLAN_ACCESS } from "@/lib/performance/compensation-plan";
import { planPaths, requireDraftPlan } from "./compensationPlanWrites";
import { deleteCompensationPlanSchema } from "./deleteCompensationPlan.schema";

/**
 * Delete a draft plan and its items (FK cascade).
 *
 * Committed plans cannot be deleted: they are the record of what was decided,
 * and the ratings they wrote are already live in each person's history. Cleaning
 * one up would leave those dated rating rows with no explanation.
 */
export const deleteCompensationPlan = secureActionClient
  .metadata({
    action: "delete-compensation-plan",
    permission: COMPENSATION_PLAN_ACCESS,
  })
  .inputSchema(deleteCompensationPlanSchema)
  .action(async ({ parsedInput: { planId } }): Promise<{ ok: true }> => {
    await requireDraftPlan(planId);

    await db.delete(compensationPlan).where(eq(compensationPlan.id, planId));

    for (const path of planPaths(planId)) revalidatePath(path);

    return { ok: true };
  });
