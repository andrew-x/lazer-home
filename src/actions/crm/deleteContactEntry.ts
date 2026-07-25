"use server";

import { secureActionClient } from "@/lib/core/action";
import { deleteEntrySchema } from "./entries.schema";
import { contactEntryMutations, deleteEntry } from "./entryMutations";

/**
 * Delete a contact entry. Gated on `crm.edit` — any CRM editor may remove any
 * entry (no per-entry ownership check, by product decision). Delegates to the
 * shared entry core (see `entryMutations.ts`).
 */
export const deleteContactEntry = secureActionClient
  .metadata({ action: "delete-contact-entry", permission: { crm: ["edit"] } })
  .inputSchema(deleteEntrySchema)
  .action(({ parsedInput }) =>
    deleteEntry(contactEntryMutations, { id: parsedInput.id }),
  );
