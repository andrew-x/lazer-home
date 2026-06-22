"use server";

import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { companies } from "@/lib/db/schema";
import { createCompanySchema } from "./createCompany.schema";

/** Create a company. Gated on `companies.create`. */
export const createCompany = secureActionClient
  .metadata({
    action: "create-company",
    permission: { companies: ["create"] },
  })
  .inputSchema(createCompanySchema)
  .action(async ({ parsedInput }) => {
    const [created] = await db
      .insert(companies)
      .values({
        id: generateId("company"),
        name: parsedInput.name,
        websiteUrl: parsedInput.websiteUrl,
        isPartner: parsedInput.isPartner,
      })
      .returning({ id: companies.id });

    revalidatePath("/companies");
    return { id: created.id };
  });
