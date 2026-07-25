"use server";

import { secureActionClient } from "@/lib/core/action";
import { addCompanyEntrySchema } from "./entries.schema";
import { addEntry, companyEntryMutations } from "./entryMutations";

/**
 * Append a timestamped note entry to a company's log. Gated on `crm.edit`.
 * Delegates to the shared entry core (see `entryMutations.ts`).
 */
export const addCompanyEntry = secureActionClient
  .metadata({ action: "add-company-entry", permission: { crm: ["edit"] } })
  .inputSchema(addCompanyEntrySchema)
  .action(({ parsedInput, ctx }) =>
    addEntry(
      companyEntryMutations,
      {
        parentId: parsedInput.companyId,
        kind: parsedInput.kind,
        body: parsedInput.body,
      },
      ctx.user,
    ),
  );
