"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { contactEntries } from "@/lib/db/schema";
import { deleteEntrySchema } from "./entries.schema";

/**
 * Delete a contact entry. Gated on `crm.edit` — any CRM editor may remove any
 * entry (no per-entry ownership check, by product decision). `.returning()`
 * confirms the row existed and yields the parent id for revalidation.
 */
export const deleteContactEntry = secureActionClient
  .metadata({ action: "delete-contact-entry", permission: { crm: ["edit"] } })
  .inputSchema(deleteEntrySchema)
  .action(async ({ parsedInput }) => {
    const [row] = await db
      .delete(contactEntries)
      .where(eq(contactEntries.id, parsedInput.id))
      .returning({ contactId: contactEntries.contactId });
    if (!row) {
      throw new UserSafeActionError("That entry no longer exists.");
    }

    revalidatePath(`/contacts/${row.contactId}`);
    revalidatePath("/contacts");
    return { id: parsedInput.id };
  });
