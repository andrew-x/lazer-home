"use server";

import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { opportunityEntries } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { addOpportunityEntrySchema } from "./entries.schema";
import { resolveAuthorStaffId } from "./resolveAuthorStaffId";

/**
 * Append a timestamped note or next-step entry to an opportunity's log. Gated on
 * `crm.edit`. Author resolved server-side from the session; the opportunity FK is
 * guarded by the DB. The pipeline counterpart to `addContactEntry`.
 */
export const addOpportunityEntry = secureActionClient
  .metadata({ action: "add-opportunity-entry", permission: { crm: ["edit"] } })
  .inputSchema(addOpportunityEntrySchema)
  .action(async ({ parsedInput, ctx }) => {
    const authorStaffId = await resolveAuthorStaffId(ctx.user);
    const entryId = generateId("oentry");
    try {
      await db.insert(opportunityEntries).values({
        id: entryId,
        opportunityId: parsedInput.opportunityId,
        kind: parsedInput.kind,
        body: parsedInput.body,
        authorStaffId,
      });
    } catch {
      throw new UserSafeActionError("That opportunity no longer exists.");
    }

    revalidatePath("/opportunities");
    return { id: entryId };
  });
