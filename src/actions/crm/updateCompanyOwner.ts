"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { companies } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { updateCompanyOwnerSchema } from "./updateCompanyOwner.schema";

/** Reassign (or clear) a company's owner in place, without touching its other
 * fields — the write behind the inline owner field on the company page. Gated on
 * `crm.edit`, matching `updateCompany`. `.returning()` detects a row deleted out
 * from under the edit. */
export const updateCompanyOwner = secureActionClient
  .metadata({
    action: "update-company-owner",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateCompanyOwnerSchema)
  .action(async ({ parsedInput }) => {
    const { id, ownerId } = parsedInput;
    const updated = await db
      .update(companies)
      .set({ ownerId })
      .where(eq(companies.id, id))
      .returning({ id: companies.id });

    if (updated.length === 0) {
      throw new UserSafeActionError("That company no longer exists.");
    }

    revalidatePath("/companies");
    revalidatePath(`/companies/${id}`);
    return { id };
  });
