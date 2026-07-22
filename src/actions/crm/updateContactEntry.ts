"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { contactEntries } from "@/lib/db/schema";
import { updateEntrySchema } from "./entries.schema";

/**
 * Edit the body of a contact entry. Gated on `crm.edit` — any CRM editor may
 * amend any entry (no per-entry ownership check, by product decision). Only the
 * body changes; `.returning()` guards against the row being deleted mid-edit and
 * hands back the parent id for revalidation.
 */
export const updateContactEntry = secureActionClient
  .metadata({ action: "update-contact-entry", permission: { crm: ["edit"] } })
  .inputSchema(updateEntrySchema)
  .action(async ({ parsedInput }) => {
    const [row] = await db
      .update(contactEntries)
      .set({ body: parsedInput.body })
      .where(eq(contactEntries.id, parsedInput.id))
      .returning({ contactId: contactEntries.contactId });
    if (!row) {
      throw new UserSafeActionError("That entry no longer exists.");
    }

    revalidatePath(`/contacts/${row.contactId}`);
    revalidatePath("/contacts");
    return { id: parsedInput.id };
  });
