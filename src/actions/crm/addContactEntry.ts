"use server";

import { secureActionClient } from "@/lib/core/action";
import { addContactEntrySchema } from "./entries.schema";
import { addEntry, contactEntryMutations } from "./entryMutations";

/**
 * Append a timestamped note entry to a contact's log. Gated on `crm.edit`.
 * Delegates to the shared entry core (see `entryMutations.ts`).
 */
export const addContactEntry = secureActionClient
  .metadata({ action: "add-contact-entry", permission: { crm: ["edit"] } })
  .inputSchema(addContactEntrySchema)
  .action(({ parsedInput, ctx }) =>
    addEntry(
      contactEntryMutations,
      { parentId: parsedInput.contactId, body: parsedInput.body },
      ctx.user,
    ),
  );
