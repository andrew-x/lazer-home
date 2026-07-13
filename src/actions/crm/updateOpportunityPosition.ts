"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { opportunities } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { requiresProject } from "@/lib/opportunity-pipeline";
import { opportunityHasProject } from "./opportunityHasProject";
import { updateOpportunityPositionSchema } from "./updateOpportunityPosition.schema";

/**
 * Persist a kanban move — an opportunity's status column and its fractional
 * `position` within it. Gated on `crm.edit`. The board sends an absolute
 * `{ status, position }` (computed client-side from the drop's neighbors), so
 * this is a single-row update with no server-side renumbering.
 */
export const updateOpportunityPosition = secureActionClient
  .metadata({
    action: "update-opportunity-position",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateOpportunityPositionSchema)
  .action(async ({ parsedInput }) => {
    // Delivery stages require a linked project (see `requiresProject`). Enforced
    // here too — not just in the UI — so the rule can't be bypassed. Only fire
    // on a genuine move *into* a requiring stage, so reordering a card within a
    // delivery column (status unchanged) isn't blocked.
    const [current] = await db
      .select({ status: opportunities.status })
      .from(opportunities)
      .where(eq(opportunities.id, parsedInput.id))
      .limit(1);
    if (
      current &&
      parsedInput.status !== current.status &&
      requiresProject(parsedInput.status) &&
      !(await opportunityHasProject(parsedInput.id))
    ) {
      throw new UserSafeActionError(
        "Create a project for this opportunity before moving it to Allocating or later.",
      );
    }

    await db
      .update(opportunities)
      .set({ status: parsedInput.status, position: parsedInput.position })
      .where(eq(opportunities.id, parsedInput.id));

    revalidatePath("/opportunities");
  });
