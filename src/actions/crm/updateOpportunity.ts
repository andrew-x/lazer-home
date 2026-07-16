"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import {
  opportunities,
  opportunityContacts,
  opportunityOwners,
  opportunitySourceContacts,
  opportunitySourceStaff,
} from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { requiresProject } from "@/lib/opportunity-pipeline";
import { opportunityHasProject } from "./opportunityHasProject";
import { writeOpportunityLinks } from "./opportunityLinks";
import { updateOpportunitySchema } from "./updateOpportunity.schema";

/**
 * Edit an opportunity and its people links (one transaction). Gated on
 * `crm.edit`. The four people junctions are replaced wholesale (delete +
 * re-insert the id sets) — the same shape
 * `createOpportunity` writes. A move into a delivery stage requires a linked
 * project (see `requiresProject`), enforced here as well as in the UI.
 */
export const updateOpportunity = secureActionClient
  .metadata({
    action: "update-opportunity",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateOpportunitySchema)
  .action(async ({ parsedInput }) => {
    // The delivery-stage project rule only bites on a *transition* into a stage
    // that requires one — editing name/owners/next-steps on an opportunity
    // already in such a stage must not be blocked. Only enforce when the status
    // actually changes into a requiring stage without a linked project.
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

    const { id } = parsedInput;

    await db.transaction(async (tx) => {
      const updated = await tx
        .update(opportunities)
        .set({
          name: parsedInput.name,
          companyId: parsedInput.companyId,
          lineOfBusiness: parsedInput.lineOfBusiness,
          source: parsedInput.source,
          status: parsedInput.status,
          nextSteps: parsedInput.nextSteps,
        })
        .where(eq(opportunities.id, id))
        .returning({ id: opportunities.id });

      if (updated.length === 0) {
        throw new UserSafeActionError("That opportunity no longer exists.");
      }

      // Replace the people junctions wholesale.
      await tx
        .delete(opportunityContacts)
        .where(eq(opportunityContacts.opportunityId, id));
      await tx
        .delete(opportunityOwners)
        .where(eq(opportunityOwners.opportunityId, id));
      await tx
        .delete(opportunitySourceContacts)
        .where(eq(opportunitySourceContacts.opportunityId, id));
      await tx
        .delete(opportunitySourceStaff)
        .where(eq(opportunitySourceStaff.opportunityId, id));

      await writeOpportunityLinks(tx, id, {
        contactIds: parsedInput.contactIds,
        ownerIds: parsedInput.ownerIds,
        sourceContactIds: parsedInput.sourceContactIds,
        sourceStaffIds: parsedInput.sourceStaffIds,
      });
    });

    revalidatePath("/opportunities");
    return { id };
  });
