"use server";

import { secureActionClient } from "@/lib/core/action";
import { updateEntrySchema } from "./entries.schema";
import { opportunityEntryMutations, updateEntryBody } from "./entryMutations";

/**
 * Edit the body of an opportunity entry. Gated on `crm.edit` — any CRM editor
 * may amend any entry. Delegates to the shared entry core (see
 * `entryMutations.ts`).
 */
export const updateOpportunityEntry = secureActionClient
  .metadata({
    action: "update-opportunity-entry",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateEntrySchema)
  .action(({ parsedInput }) =>
    updateEntryBody(opportunityEntryMutations, {
      id: parsedInput.id,
      body: parsedInput.body,
    }),
  );
