"use server";

import { eq, type InferInsertModel } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { companies } from "@/lib/db/schema";
import { revalidateCompany } from "./revalidate";
import { updateCompanyFieldSchema } from "./updateCompanyField.schema";

type CompanyUpdate = Partial<InferInsertModel<typeof companies>>;

/**
 * Edit a *single* field of a company from its detail page's inline fields
 * (owner, location). Gated on `crm.edit`. A discriminated union on `field`: each
 * variant writes only the slice that changed instead of re-sending the whole
 * record, so a concurrent edit to another field isn't clobbered (mirrors
 * `updateOpportunityField`). Every write is `.returning()`-guarded so a row
 * deleted out from under the edit surfaces as a clean error.
 */
export const updateCompanyField = secureActionClient
  .metadata({
    action: "update-company-field",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateCompanyFieldSchema)
  .action(async ({ parsedInput }) => {
    const { id } = parsedInput;

    const setCompany = async (values: CompanyUpdate) => {
      const rows = await db
        .update(companies)
        .set(values)
        .where(eq(companies.id, id))
        .returning({ id: companies.id });
      assertRowExists(rows, "company");
    };

    switch (parsedInput.field) {
      case "owner":
        await setCompany({ ownerId: parsedInput.ownerId });
        break;
      case "location":
        await setCompany({ location: parsedInput.location });
        break;
    }

    revalidateCompany(id);
    return { id };
  });
