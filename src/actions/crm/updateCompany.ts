"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { companies } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
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

    if (updated.length === 0) {
      throw new UserSafeActionError("That company no longer exists.");
    }

    revalidatePath("/companies");
    revalidatePath(`/companies/${id}`);
    return { id };
  });
