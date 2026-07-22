"use server";

import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { companies } from "@/lib/db/schema";
import { createCompanySchema } from "./createCompany.schema";

/** Create a company. Gated on `crm.edit` (the single CRM-write capability). */
export const createCompany = secureActionClient
  .metadata({
    action: "create-company",
    permission: { crm: ["edit"] },
  })
  .inputSchema(createCompanySchema)
  .action(async ({ parsedInput }) => {
    // Minted up front so the created id can be returned to callers without a
    // `.returning()` round-trip (mirrors createContact / createOpportunity).
    const companyId = generateId("company");
    await db.insert(companies).values({
      id: companyId,
      name: parsedInput.name,
      websiteUrl: parsedInput.websiteUrl,
      isPartner: parsedInput.isPartner,
    });

    revalidatePath("/companies");
    return { id: companyId };
  });
