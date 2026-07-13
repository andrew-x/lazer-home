"use server";

import { max } from "drizzle-orm";
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
import { createOpportunitySchema } from "./createOpportunity.schema";

/**
 * Create an opportunity and its people links (one transaction). Gated on
 * `crm.edit`. Related entities (company, contacts) are created via their own
 * actions first, so this only consumes their ids. The conditional
 * source-referral rules are enforced by `createOpportunitySchema`.
 */
export const createOpportunity = secureActionClient
  .metadata({
    action: "create-opportunity",
    permission: { crm: ["edit"] },
  })
  .inputSchema(createOpportunitySchema)
  .action(async ({ parsedInput }) => {
    const opportunityId = generateId("opp");

    // Dedupe each id list so a duplicate can't trip the junction unique index.
    const contactIds = [...new Set(parsedInput.contactIds)];
    const ownerIds = [...new Set(parsedInput.ownerIds)];
    const sourceContactIds = [...new Set(parsedInput.sourceContactIds)];
    const sourceStaffIds = [...new Set(parsedInput.sourceStaffIds)];

    await db.transaction(async (tx) => {
      // `position` is a single global ordering; a new opportunity goes after
      // everything, so it lands at the end of whichever board column it's in.
      const [{ maxPosition }] = await tx
        .select({ maxPosition: max(opportunities.position) })
        .from(opportunities);

      await tx.insert(opportunities).values({
        id: opportunityId,
        name: parsedInput.name,
        companyId: parsedInput.companyId,
        lineOfBusiness: parsedInput.lineOfBusiness,
        source: parsedInput.source,
        status: parsedInput.status,
        nextSteps: parsedInput.nextSteps,
        position: (maxPosition ?? 0) + 1,
      });

      if (contactIds.length > 0) {
        await tx.insert(opportunityContacts).values(
          contactIds.map((contactId) => ({
            id: generateId("opp-contact"),
            opportunityId,
            contactId,
          })),
        );
      }

      if (ownerIds.length > 0) {
        await tx.insert(opportunityOwners).values(
          ownerIds.map((staffId) => ({
            id: generateId("opp-owner"),
            opportunityId,
            staffId,
          })),
        );
      }

      if (sourceContactIds.length > 0) {
        await tx.insert(opportunitySourceContacts).values(
          sourceContactIds.map((contactId) => ({
            id: generateId("opp-src-contact"),
            opportunityId,
            contactId,
          })),
        );
      }

      if (sourceStaffIds.length > 0) {
        await tx.insert(opportunitySourceStaff).values(
          sourceStaffIds.map((staffId) => ({
            id: generateId("opp-src-staff"),
            opportunityId,
            staffId,
          })),
        );
      }
    });

    revalidatePath("/opportunities");
    return { id: opportunityId };
  });
