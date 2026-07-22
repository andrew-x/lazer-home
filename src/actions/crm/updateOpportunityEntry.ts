"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { opportunityEntries } from "@/lib/db/schema";
import { updateEntrySchema } from "./entries.schema";

/**
 * Edit the body of an opportunity entry. Gated on `crm.edit` — any CRM editor may
 * amend any entry. `.returning()` guards against a mid-edit delete.
 */
export const updateOpportunityEntry = secureActionClient
  .metadata({
    action: "update-opportunity-entry",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateEntrySchema)
  .action(async ({ parsedInput }) => {
    const [row] = await db
      .update(opportunityEntries)
      .set({ body: parsedInput.body })
      .where(eq(opportunityEntries.id, parsedInput.id))
      .returning({ id: opportunityEntries.id });
    if (!row) {
      throw new UserSafeActionError("That entry no longer exists.");
    }

    revalidatePath("/opportunities");
    return { id: parsedInput.id };
  });
