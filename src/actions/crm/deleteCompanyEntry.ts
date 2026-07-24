"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { companyEntries } from "@/lib/db/schema";
import { deleteEntrySchema } from "./entries.schema";

/**
 * Delete a company entry. Gated on `crm.edit` — any CRM editor may remove any
 * entry (no per-entry ownership check, by product decision). `.returning()`
 * confirms the row existed and yields the parent id for revalidation.
 */
export const deleteCompanyEntry = secureActionClient
  .metadata({ action: "delete-company-entry", permission: { crm: ["edit"] } })
  .inputSchema(deleteEntrySchema)
  .action(async ({ parsedInput }) => {
    const [row] = await db
      .delete(companyEntries)
      .where(eq(companyEntries.id, parsedInput.id))
      .returning({ companyId: companyEntries.companyId });
    if (!row) {
      throw new UserSafeActionError("That entry no longer exists.");
    }

    revalidatePath(`/companies/${row.companyId}`);
    revalidatePath("/companies");
    return { id: parsedInput.id };
  });
