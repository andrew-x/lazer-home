"use server";

import { secureActionClient } from "@/lib/core/action";
import { deleteEntrySchema } from "./entries.schema";
import { companyEntryMutations, deleteEntry } from "./entryMutations";

/**
 * Delete a company entry. Gated on `crm.edit` — any CRM editor may remove any
 * entry (no per-entry ownership check, by product decision). Delegates to the
 * shared entry core (see `entryMutations.ts`).
 */
export const deleteCompanyEntry = secureActionClient
  .metadata({ action: "delete-company-entry", permission: { crm: ["edit"] } })
  .inputSchema(deleteEntrySchema)
  .action(({ parsedInput }) =>
    deleteEntry(companyEntryMutations, { id: parsedInput.id }),
  );
