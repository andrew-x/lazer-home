"use server";

import { eq } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { companyContactRelationships } from "@/lib/db/schema";
import { deleteCompanyContactRelationshipSchema } from "./companyContactRelationship.schema";
import { revalidateCompanyContactRelationship } from "./revalidate";

/**
 * Remove a company ↔ contact relationship. Gated on `crm.edit` — any CRM editor
 * may remove any relationship (no per-row ownership, matching the entry actions).
 * Returns the pair from the delete so both detail pages can be revalidated.
 */
export const deleteCompanyContactRelationship = secureActionClient
  .metadata({
    action: "delete-company-contact-relationship",
    permission: { crm: ["edit"] },
  })
  .inputSchema(deleteCompanyContactRelationshipSchema)
  .action(async ({ parsedInput: { id } }) => {
    const rows = await db
      .delete(companyContactRelationships)
      .where(eq(companyContactRelationships.id, id))
      .returning({
        companyId: companyContactRelationships.companyId,
        contactId: companyContactRelationships.contactId,
      });
    assertRowExists(rows, "relationship");

    revalidateCompanyContactRelationship(rows[0].companyId, rows[0].contactId);
    return { id };
  });
