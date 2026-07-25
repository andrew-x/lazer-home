"use server";

import { secureActionClient } from "@/lib/core/action";
import { updateEntrySchema } from "./entries.schema";
import { contactEntryMutations, updateEntryBody } from "./entryMutations";

/**
 * Edit the body of a contact entry. Gated on `crm.edit` — any CRM editor may
 * amend any entry (no per-entry ownership check, by product decision).
 * Delegates to the shared entry core (see `entryMutations.ts`).
 */
export const updateContactEntry = secureActionClient
  .metadata({ action: "update-contact-entry", permission: { crm: ["edit"] } })
  .inputSchema(updateEntrySchema)
  .action(({ parsedInput }) =>
    updateEntryBody(contactEntryMutations, {
      id: parsedInput.id,
      body: parsedInput.body,
    }),
  );
