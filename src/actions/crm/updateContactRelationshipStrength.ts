"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { contacts } from "@/lib/db/schema";
import { updateContactRelationshipStrengthSchema } from "./updateContactRelationshipStrength.schema";

/** Set a contact's relationship strength (1–5) in place, without touching its
 * other fields — the write behind the inline star rating on the contact page.
 * Independent of the manager/company rules, so it skips `assertValidManager` (a
 * full-record `updateContact` would wrongly re-validate them). Gated on
 * `crm.edit`, matching `updateContact`. `.returning()` detects a row deleted out
 * from under the edit. */
export const updateContactRelationshipStrength = secureActionClient
  .metadata({
    action: "update-contact-relationship-strength",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateContactRelationshipStrengthSchema)
  .action(async ({ parsedInput }) => {
    const { id, relationshipStrength } = parsedInput;
    const updated = await db
      .update(contacts)
      .set({ relationshipStrength })
      .where(eq(contacts.id, id))
      .returning({ id: contacts.id });

    if (updated.length === 0) {
      throw new UserSafeActionError("That contact no longer exists.");
    }

    revalidatePath("/contacts");
    revalidatePath(`/contacts/${id}`);
    return { id };
  });
