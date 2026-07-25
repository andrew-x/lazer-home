"use server";

import { eq } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { companies } from "@/lib/db/schema";
import { revalidateCompany } from "./revalidate";
import { updateCompanySchema } from "./updateCompany.schema";

/** Edit a company's core fields and owner. Gated on `crm.edit` (the single
 * CRM-write capability). `.returning()` detects a row deleted out from under
 * the edit. */
export const updateCompany = secureActionClient
  .metadata({
    action: "update-company",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateCompanySchema)
  .action(async ({ parsedInput }) => {
    const { id } = parsedInput;
    const updated = await db
      .update(companies)
      .set({
        name: parsedInput.name,
        websiteUrl: parsedInput.websiteUrl,
        isPartner: parsedInput.isPartner,
        ownerId: parsedInput.ownerId,
      })
      .where(eq(companies.id, id))
      .returning({ id: companies.id });

    assertRowExists(updated, "company");

    revalidateCompany(id);
    return { id };
  });
