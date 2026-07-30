"use server";

import { eq } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { contacts } from "@/lib/db/schema";
import { revalidateContact } from "./revalidate";
import { updateContactSchema } from "./updateContact.schema";

/**
 * Edit a contact's identity block — names, job title, and active/inactive status.
 * Gated on `crm.edit`, the single CRM-write capability. `.returning()` detects a
 * row deleted out from under the edit.
 *
 * Narrower than it looks from the name: the rest of a contact (email, phone,
 * LinkedIn, employer, location, owner, relationship strength) is edited in place in
 * the detail sidebar via `updateContactField`, so this writes only the four columns
 * the dialog shows. That's why there's no transaction here any more — the employer
 * write, and the `reports_to` link it invalidates, moved to `updateContactField`'s
 * `company` case, and the uniquely-constrained email moved to its `email` case.
 *
 * `isActive` IS part of this save — the Status field lives in the edit dialog. Note
 * the other writer: `createContactRelationship` flips the *predecessor* to inactive
 * when a successor is linked, so a stale form submitted after that would set it back
 * to active. That's the ordinary last-write-wins of a dialog, not a special case.
 */
export const updateContact = secureActionClient
  .metadata({
    action: "update-contact",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateContactSchema)
  .action(async ({ parsedInput }) => {
    const { id } = parsedInput;

    const updated = await db
      .update(contacts)
      .set({
        firstName: parsedInput.firstName,
        lastName: parsedInput.lastName,
        role: parsedInput.role,
        isActive: parsedInput.isActive,
      })
      .where(eq(contacts.id, id))
      .returning({ id: contacts.id });
    assertRowExists(updated, "contact");

    revalidateContact(id);
    return { id };
  });
