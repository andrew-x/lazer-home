"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { contacts } from "@/lib/db/schema";
import { updateContactLocationSchema } from "./updateContactLocation.schema";

/** Set (or clear) a contact's location in place, without touching its other
 * fields — the write behind the inline location field on the contact page. Gated
 * on `crm.edit`, matching `updateContact`. `.returning()` detects a row deleted
 * out from under the edit. */
export const updateContactLocation = secureActionClient
  .metadata({
    action: "update-contact-location",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateContactLocationSchema)
  .action(async ({ parsedInput }) => {
    const { id, location } = parsedInput;
    const updated = await db
      .update(contacts)
      .set({ location })
      .where(eq(contacts.id, id))
      .returning({ id: contacts.id });

    if (updated.length === 0) {
      throw new UserSafeActionError("That contact no longer exists.");
    }

    revalidatePath("/contacts");
    revalidatePath(`/contacts/${id}`);
    return { id };
  });
