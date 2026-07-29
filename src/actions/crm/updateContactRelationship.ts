"use server";

import { and, eq } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { contactRelationships } from "@/lib/db/schema";
import { updateContactRelationshipSchema } from "./contactRelationship.schema";
import { revalidateContactRelationship } from "./revalidate";

/**
 * Reword a `related` link's description — the only editable thing about any
 * contact ↔ contact relationship. The endpoints and the kind are immutable, so
 * re-pointing or re-typing a link means deleting and re-adding it.
 *
 * Scoped to `kind = 'related'` in the WHERE so a directional row can't be given a
 * description (the `contact_relationships_description_kind` CHECK is the real
 * backstop; this turns the attempt into a clean "not found" instead of a 23514).
 * Gated on `crm.edit`; returns the pair so both contact pages are revalidated.
 */
export const updateContactRelationship = secureActionClient
  .metadata({
    action: "update-contact-relationship",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateContactRelationshipSchema)
  .action(async ({ parsedInput: { id, description } }) => {
    const rows = await db
      .update(contactRelationships)
      .set({ description })
      .where(
        and(
          eq(contactRelationships.id, id),
          eq(contactRelationships.kind, "related"),
        ),
      )
      .returning({
        contactId: contactRelationships.contactId,
        relatedContactId: contactRelationships.relatedContactId,
      });
    assertRowExists(rows, "relationship");

    revalidateContactRelationship(rows[0].contactId, rows[0].relatedContactId);
    return { id };
  });
