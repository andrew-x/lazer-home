"use server";

import { and, eq } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { contactRelationships, contacts } from "@/lib/db/schema";
import { mapContactEmailConflict } from "./contactChecks";
import { revalidateContact, revalidateContactRelationship } from "./revalidate";
import { updateContactSchema } from "./updateContact.schema";

/**
 * Edit a contact's identity, links, employer, owner and active/inactive status.
 * Gated on `crm.edit` — the single CRM-write capability. `.returning()` detects a
 * row deleted out from under the edit.
 *
 * Relationships are **not** edited here — they live in `contact_relationships` and
 * are managed from the contact page's Relationships section. But changing the
 * employer still touches one: a `reports_to` link is only valid between colleagues
 * at the same company, so moving a contact to a new company **removes** their
 * manager link rather than leaving a row the write path would now reject. (The old
 * `managerId` column got the same effect by having the picker silently reset on a
 * company switch; the edit dialog now warns before you save.)
 *
 * `isActive` IS part of this save — the Status field lives in the edit dialog — so
 * the form must round-trip it like `ownerId`. Note the other writer:
 * `createContactRelationship` flips the *predecessor* to inactive when a successor
 * is linked, so a stale form submitted after that would set it back to active.
 * That's the ordinary last-write-wins of a full-record dialog, not a special case.
 */
export const updateContact = secureActionClient
  .metadata({
    action: "update-contact",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateContactSchema)
  .action(async ({ parsedInput }) => {
    const { id } = parsedInput;

    let droppedManagerId: string | null;
    try {
      // One transaction: `RETURNING` on an UPDATE yields the *new* row, so the old
      // employer has to be read first, and the read + write + dependent delete must
      // commit together or a concurrent edit could leave a cross-company manager.
      droppedManagerId = await db.transaction(async (tx) => {
        const [before] = await tx
          .select({ companyId: contacts.companyId })
          .from(contacts)
          .where(eq(contacts.id, id))
          .limit(1);
        assertRowExists(before ? [before] : [], "contact");

        const updated = await tx
          .update(contacts)
          .set({
            firstName: parsedInput.firstName,
            lastName: parsedInput.lastName,
            email: parsedInput.email,
            phone: parsedInput.phone,
            companyId: parsedInput.companyId,
            role: parsedInput.role,
            linkedinUrl: parsedInput.linkedinUrl,
            ownerId: parsedInput.ownerId,
            relationshipStrength: parsedInput.relationshipStrength,
            isActive: parsedInput.isActive,
          })
          .where(eq(contacts.id, id))
          .returning({ id: contacts.id });
        assertRowExists(updated, "contact");

        if (before.companyId === parsedInput.companyId) return null;

        // The employer changed, so any `reports_to` link is now cross-company —
        // invalid by the rule `assertValidContactRelationship` enforces on write.
        // Drop it rather than leave a row the write path would reject.
        const removed = await tx
          .delete(contactRelationships)
          .where(
            and(
              eq(contactRelationships.contactId, id),
              eq(contactRelationships.kind, "reports_to"),
            ),
          )
          .returning({
            relatedContactId: contactRelationships.relatedContactId,
          });
        return removed[0]?.relatedContactId ?? null;
      });
    } catch (error) {
      mapContactEmailConflict(error);
    }

    revalidateContact(id);
    // The dropped link also rendered on the ex-manager's page, under Direct reports.
    if (droppedManagerId !== null) {
      revalidateContactRelationship(id, droppedManagerId);
    }
    return { id };
  });
