"use server";

import { secureActionClient } from "@/lib/core/action";
import { addOpportunityEntrySchema } from "./entries.schema";
import { addEntry, opportunityEntryMutations } from "./entryMutations";

/**
 * Append a timestamped note or next-step entry to an opportunity's log. Gated on
 * `crm.edit`. Delegates to the shared entry core (see `entryMutations.ts`).
 */
export const addOpportunityEntry = secureActionClient
  .metadata({ action: "add-opportunity-entry", permission: { crm: ["edit"] } })
  .inputSchema(addOpportunityEntrySchema)
  .action(({ parsedInput, ctx }) =>
    addEntry(
      opportunityEntryMutations,
      {
        parentId: parsedInput.opportunityId,
        kind: parsedInput.kind,
        body: parsedInput.body,
      },
      ctx.user,
    ),
  );
