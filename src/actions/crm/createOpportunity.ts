"use server";

import { max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { opportunities } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { requiresProject } from "@/lib/opportunity-pipeline";
import { createOpportunitySchema } from "./createOpportunity.schema";
import { writeOpportunityLinks } from "./opportunityLinks";

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
    // A brand-new opportunity can't have a linked project yet, so it must not
    // start in a delivery stage (Allocating onward) — that state is what the
    // project guard exists to prevent. Create it earlier, then add a project as
    // it advances. See `requiresProject`.
    if (requiresProject(parsedInput.status)) {
      throw new UserSafeActionError(
        "A new opportunity can't start at Allocating or later — create it in an earlier stage, then add a project as it advances.",
      );
    }

    const opportunityId = generateId("opp");

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
        position: (maxPosition ?? 0) + 1,
      });

      await writeOpportunityLinks(tx, opportunityId, {
        contactIds: parsedInput.contactIds,
        ownerIds: parsedInput.ownerIds,
        sourceContactIds: parsedInput.sourceContactIds,
        sourceStaffIds: parsedInput.sourceStaffIds,
      });
    });

    revalidatePath("/opportunities");
    return { id: opportunityId };
  });
