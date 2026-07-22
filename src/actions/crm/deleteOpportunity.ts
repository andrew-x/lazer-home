"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { detachProjectFromOpportunity } from "@/actions/projects/detachProjectFromOpportunity";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { opportunities } from "@/lib/db/schema";
import { deleteOpportunitySchema } from "./deleteOpportunity.schema";

/**
 * Delete an opportunity. Gated on `crm.edit` (mirroring the other opportunity
 * mutations). If the opportunity has a project, its delivery footprint is cleaned
 * up first — `detachProjectFromOpportunity` deletes the project when this
 * opportunity solely owns it, otherwise removes just this opportunity's roles and
 * unlinks it. This runs **before** the opportunity row is deleted so role
 * provenance (`projectRoles.opportunityId`) is still intact; the opportunity's
 * junction rows (contacts, owners, sources, entries) cascade on delete.
 */
export const deleteOpportunity = secureActionClient
  .metadata({
    action: "delete-opportunity",
    permission: { crm: ["edit"] },
  })
  .inputSchema(deleteOpportunitySchema)
  .action(async ({ parsedInput: { id } }) => {
    await db.transaction(async (tx) => {
      const [opportunity] = await tx
        .select({ projectId: opportunities.projectId })
        .from(opportunities)
        .where(eq(opportunities.id, id))
        .limit(1);

      if (!opportunity) {
        throw new UserSafeActionError("That opportunity no longer exists.");
      }

      if (opportunity.projectId) {
        await detachProjectFromOpportunity(tx, {
          opportunityId: id,
          projectId: opportunity.projectId,
        });
      }

      await tx.delete(opportunities).where(eq(opportunities.id, id));
    });

    revalidatePath("/opportunities");
    revalidatePath("/projects");
    return { id };
  });
