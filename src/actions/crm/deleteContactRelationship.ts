"use server";

import { eq } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { contactRelationships } from "@/lib/db/schema";
import { deleteContactRelationshipSchema } from "./contactRelationship.schema";
import { revalidateContactRelationship } from "./revalidate";

/**
 * Remove a contact ↔ contact relationship of any kind. Gated on `crm.edit` — any
 * CRM editor may remove any relationship (no per-row ownership, matching the
 * company-contact and entry actions). Returns the pair so both contact pages are
 * revalidated.
 *
 * Removing a `succeeds` link deliberately does **not** reactivate the predecessor.
 * `isActive` is an independent fact about a person ("we no longer deal with them"),
 * not a derivation of the link: reviving them automatically would surprise, and if
 * the link was a mistake the old record is probably still inactive. Reactivating is
 * an explicit choice, via the Status field in the contact's edit dialog.
 */
export const deleteContactRelationship = secureActionClient
  .metadata({
    action: "delete-contact-relationship",
    permission: { crm: ["edit"] },
  })
  .inputSchema(deleteContactRelationshipSchema)
  .action(async ({ parsedInput: { id } }) => {
    const rows = await db
      .delete(contactRelationships)
      .where(eq(contactRelationships.id, id))
      .returning({
        contactId: contactRelationships.contactId,
        relatedContactId: contactRelationships.relatedContactId,
      });
    assertRowExists(rows, "relationship");

    revalidateContactRelationship(rows[0].contactId, rows[0].relatedContactId);
    return { id };
  });
