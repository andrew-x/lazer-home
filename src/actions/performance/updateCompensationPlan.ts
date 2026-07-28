"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { compensationPlan } from "@/lib/db/schema";
import { COMPENSATION_PLAN_ACCESS } from "@/lib/performance/compensation-plan";
import { planPaths, requireDraftPlan } from "./compensationPlanWrites";
import { updateCompensationPlanSchema } from "./updateCompensationPlan.schema";

/**
 * Rename a draft plan or move its effective date.
 *
 * The date is editable precisely because commit rejects a plan dated before any
 * member's latest rating — that rejection is only fixable if the date can be
 * changed. Committed plans are frozen (`requireDraftPlan`).
 */
export const updateCompensationPlan = secureActionClient
  .metadata({
    action: "update-compensation-plan",
    permission: COMPENSATION_PLAN_ACCESS,
  })
  .inputSchema(updateCompensationPlanSchema)
  .action(
    async ({
      parsedInput: { planId, name, effectiveDate },
    }): Promise<{ ok: true }> => {
      await requireDraftPlan(planId);

      await db
        .update(compensationPlan)
        .set({ name, effectiveDate })
        .where(eq(compensationPlan.id, planId));

      for (const path of planPaths(planId)) revalidatePath(path);

      return { ok: true };
    },
  );
