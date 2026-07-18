"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { opportunityEntries } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { deleteEntrySchema } from "./entries.schema";

/**
 * Delete an opportunity entry. Gated on `crm.edit` — any CRM editor may remove
 * any entry. `.returning()` confirms the row existed.
 */
export const deleteOpportunityEntry = secureActionClient
  .metadata({
    action: "delete-opportunity-entry",
    permission: { crm: ["edit"] },
  })
  .inputSchema(deleteEntrySchema)
  .action(async ({ parsedInput }) => {
    const [row] = await db
      .delete(opportunityEntries)
      .where(eq(opportunityEntries.id, parsedInput.id))
      .returning({ id: opportunityEntries.id });
    if (!row) {
      throw new UserSafeActionError("That entry no longer exists.");
    }

    revalidatePath("/opportunities");
    return { id: parsedInput.id };
  });
