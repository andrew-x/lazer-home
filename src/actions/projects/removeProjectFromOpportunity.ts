"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { opportunities } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { detachProjectFromOpportunity } from "./detachProjectFromOpportunity";
import { removeProjectFromOpportunitySchema } from "./removeProjectFromOpportunity.schema";

/**
 * Remove the project from an opportunity's planner. If this opportunity solely
 * owns the project (all roles are its own and no other opportunity is linked)
 * the whole project is deleted; otherwise only this opportunity's roles are
 * removed and the project is unlinked (see `detachProjectFromOpportunity`).
 * Gated on `projects.edit`, mirroring the other planner actions. Returns whether
 * the project was deleted so the UI can message correctly.
 */
export const removeProjectFromOpportunity = secureActionClient
  .metadata({
    action: "remove-project-from-opportunity",
    permission: { projects: ["edit"] },
  })
  .inputSchema(removeProjectFromOpportunitySchema)
  .action(async ({ parsedInput: { opportunityId } }) => {
    const result = await db.transaction(async (tx) => {
      const [opportunity] = await tx
        .select({ projectId: opportunities.projectId })
        .from(opportunities)
        .where(eq(opportunities.id, opportunityId))
        .limit(1);

      if (!opportunity) {
        throw new UserSafeActionError("That opportunity no longer exists.");
      }
      if (!opportunity.projectId) {
        throw new UserSafeActionError(
          "This opportunity has no project to remove.",
        );
      }

      return detachProjectFromOpportunity(tx, {
        opportunityId,
        projectId: opportunity.projectId,
      });
    });

    revalidatePath("/projects");
    revalidatePath("/opportunities");
    return result;
  });
