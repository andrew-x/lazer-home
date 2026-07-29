"use server";

import { eq } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { companyContactRelationships } from "@/lib/db/schema";
import { updateCompanyContactRelationshipSchema } from "./companyContactRelationship.schema";
import { revalidateCompanyContactRelationship } from "./revalidate";

/**
 * Reword a relationship's description. The endpoints are immutable — re-point a
 * relationship by deleting and re-adding it. Gated on `crm.edit`; returns the
 * pair so both detail pages can be revalidated.
 */
export const updateCompanyContactRelationship = secureActionClient
  .metadata({
    action: "update-company-contact-relationship",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateCompanyContactRelationshipSchema)
  .action(async ({ parsedInput: { id, description } }) => {
    const rows = await db
      .update(companyContactRelationships)
      .set({ description })
      .where(eq(companyContactRelationships.id, id))
      .returning({
        companyId: companyContactRelationships.companyId,
        contactId: companyContactRelationships.contactId,
      });
    assertRowExists(rows, "relationship");

    revalidateCompanyContactRelationship(rows[0].companyId, rows[0].contactId);
    return { id };
  });
