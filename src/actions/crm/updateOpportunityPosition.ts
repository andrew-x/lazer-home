"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { opportunities } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { assertOpportunityTransitionAllowed } from "./assertOpportunityTransitionAllowed";
import { confirmRolesOnWon } from "./confirmRolesOnWon";
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
    // Delivery stages require a linked project (ADR 0024) — enforced here too,
    // not just in the UI, so a card can't be dragged into a delivery stage
    // without one by hitting the action directly. Transition-based, so an
    // intra-column reorder (status unchanged) isn't blocked.
    await assertOpportunityTransitionAllowed(
      parsedInput.id,
      parsedInput.status,
    );

    await db.transaction(async (tx) => {
      // Capture the prior status to detect a genuine move into `closed_won`
      // (a card dragged onto the Won column), so its tentative roles confirm in
      // the same transaction as the status write.
      const [before] = await tx
        .select({ status: opportunities.status })
        .from(opportunities)
        .where(eq(opportunities.id, parsedInput.id))
        .limit(1);
      if (!before) {
        throw new UserSafeActionError("That opportunity no longer exists.");
      }

      await tx
        .update(opportunities)
        .set({ status: parsedInput.status, position: parsedInput.position })
        .where(eq(opportunities.id, parsedInput.id));

      await confirmRolesOnWon(
        tx,
        parsedInput.id,
        parsedInput.status,
        before.status,
      );
    });

    revalidatePath("/opportunities");

    return { ok: true };
  });
