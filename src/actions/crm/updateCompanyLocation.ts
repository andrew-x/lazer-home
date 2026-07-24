"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { companies } from "@/lib/db/schema";
import { updateCompanyLocationSchema } from "./updateCompanyLocation.schema";

/** Set (or clear) a company's location in place, without touching its other
 * fields — the write behind the inline location field on the company page. Gated
 * on `crm.edit`, matching `updateCompany`. `.returning()` detects a row deleted
 * out from under the edit. */
export const updateCompanyLocation = secureActionClient
  .metadata({
    action: "update-company-location",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateCompanyLocationSchema)
  .action(async ({ parsedInput }) => {
    const { id, location } = parsedInput;
    const updated = await db
      .update(companies)
      .set({ location })
      .where(eq(companies.id, id))
      .returning({ id: companies.id });

    if (updated.length === 0) {
      throw new UserSafeActionError("That company no longer exists.");
    }

    revalidatePath("/companies");
    revalidatePath(`/companies/${id}`);
    return { id };
  });
