"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { contacts } from "@/lib/db/schema";
import { updateContactOwnerSchema } from "./updateContactOwner.schema";

/** Reassign (or clear) a contact's owner in place, without touching its other
 * fields — the write behind the inline owner field on the contact page. Owner is
 * independent of the manager/company rules, so this skips `assertValidManager`
 * (a full-record `updateContact` would wrongly re-validate it). Gated on
 * `crm.edit`, matching `updateContact`. `.returning()` detects a row deleted out
 * from under the edit. */
export const updateContactOwner = secureActionClient
  .metadata({
    action: "update-contact-owner",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateContactOwnerSchema)
  .action(async ({ parsedInput }) => {
    const { id, ownerId } = parsedInput;
    const updated = await db
      .update(contacts)
      .set({ ownerId })
      .where(eq(contacts.id, id))
      .returning({ id: contacts.id });

    if (updated.length === 0) {
      throw new UserSafeActionError("That contact no longer exists.");
    }

    revalidatePath("/contacts");
    revalidatePath(`/contacts/${id}`);
    return { id };
  });
