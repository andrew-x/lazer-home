"use server";

import { secureActionClient } from "@/lib/core/action";
import { deleteEntrySchema } from "./entries.schema";
import { deleteEntry, opportunityEntryMutations } from "./entryMutations";

/**
 * Delete an opportunity entry. Gated on `crm.edit` — any CRM editor may remove
 * any entry. Delegates to the shared entry core (see `entryMutations.ts`).
 */
export const deleteOpportunityEntry = secureActionClient
  .metadata({
    action: "delete-opportunity-entry",
    permission: { crm: ["edit"] },
  })
  .inputSchema(deleteEntrySchema)
  .action(({ parsedInput }) =>
    deleteEntry(opportunityEntryMutations, { id: parsedInput.id }),
  );
