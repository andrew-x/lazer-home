"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
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
import { updateOpportunitySchema } from "./updateOpportunity.schema";

/**
 * Edit an opportunity and its people links (one transaction). Gated on
 * `crm.edit`. The company isn't editable here. The four people junctions are
 * replaced wholesale (delete + re-insert the id sets) — the same shape
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
    if (
      requiresProject(parsedInput.status) &&
      !(await opportunityHasProject(parsedInput.id))
    ) {
      throw new UserSafeActionError(
        "Create a project for this opportunity before moving it to Allocating or later.",
      );
    }

    // Dedupe each id list so a duplicate can't trip the junction unique index.
    const contactIds = [...new Set(parsedInput.contactIds)];
    const ownerIds = [...new Set(parsedInput.ownerIds)];
    const sourceContactIds = [...new Set(parsedInput.sourceContactIds)];
    const sourceStaffIds = [...new Set(parsedInput.sourceStaffIds)];
    const { id } = parsedInput;

    await db.transaction(async (tx) => {
      const updated = await tx
        .update(opportunities)
        .set({
          name: parsedInput.name,
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

      if (contactIds.length > 0) {
        await tx.insert(opportunityContacts).values(
          contactIds.map((contactId) => ({
            id: generateId("opp-contact"),
            opportunityId: id,
            contactId,
          })),
        );
      }

      if (ownerIds.length > 0) {
        await tx.insert(opportunityOwners).values(
          ownerIds.map((staffId) => ({
            id: generateId("opp-owner"),
            opportunityId: id,
            staffId,
          })),
        );
      }

      if (sourceContactIds.length > 0) {
        await tx.insert(opportunitySourceContacts).values(
          sourceContactIds.map((contactId) => ({
            id: generateId("opp-src-contact"),
            opportunityId: id,
            contactId,
          })),
        );
      }

      if (sourceStaffIds.length > 0) {
        await tx.insert(opportunitySourceStaff).values(
          sourceStaffIds.map((staffId) => ({
            id: generateId("opp-src-staff"),
            opportunityId: id,
            staffId,
          })),
        );
      }
    });

    revalidatePath("/opportunities");
    return { id };
  });
