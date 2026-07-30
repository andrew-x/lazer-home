"use server";

import { and, eq, type InferInsertModel } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { contactRelationships, contacts } from "@/lib/db/schema";
import { mapContactEmailConflict } from "./contactChecks";
import {
  revalidateCompany,
  revalidateContact,
  revalidateContactRelationship,
} from "./revalidate";
import { updateContactFieldSchema } from "./updateContactField.schema";

type ContactUpdate = Partial<InferInsertModel<typeof contacts>>;

/**
 * Edit a *single* field of a contact from its detail page's inline fields — email,
 * phone, LinkedIn, employer, location, owner and relationship strength. Gated on
 * `crm.edit`. A discriminated union on `field`: each variant writes only the slice
 * that changed instead of re-sending the whole record — so a concurrent edit to
 * another field isn't clobbered and email normalisation isn't re-run on an
 * unrelated change (mirrors `updateOpportunityField`). Every write is
 * `.returning()`-guarded so a row deleted out from under the edit surfaces as a
 * clean error.
 *
 * Two variants carry more than a column write, and both moved here from
 * `updateContact` when the sidebar took over these fields:
 * - `email` is uniquely constrained, so a clash is mapped to a user-safe message.
 * - `company` is the employer, which a `reports_to` link depends on — see below.
 */
export const updateContactField = secureActionClient
  .metadata({
    action: "update-contact-field",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateContactFieldSchema)
  .action(async ({ parsedInput }) => {
    const { id } = parsedInput;

    const setContact = async (values: ContactUpdate) => {
      const rows = await db
        .update(contacts)
        .set(values)
        .where(eq(contacts.id, id))
        .returning({ id: contacts.id });
      assertRowExists(rows, "contact");
    };

    switch (parsedInput.field) {
      case "owner":
        await setContact({ ownerId: parsedInput.ownerId });
        break;
      case "location":
        await setContact({ location: parsedInput.location });
        break;
      case "email":
        try {
          await setContact({ email: parsedInput.email });
        } catch (error) {
          mapContactEmailConflict(error);
        }
        break;
      case "phone":
        await setContact({ phone: parsedInput.phone });
        break;
      case "linkedinUrl":
        await setContact({ linkedinUrl: parsedInput.linkedinUrl });
        break;
      case "company": {
        const { companyId } = parsedInput;
        // One transaction: `RETURNING` on an UPDATE yields the *new* row, so the
        // old employer has to be read first, and the read + write + dependent
        // delete must commit together or a concurrent edit could leave a
        // cross-company manager.
        const moved = await db.transaction(async (tx) => {
          const [before] = await tx
            .select({ companyId: contacts.companyId })
            .from(contacts)
            .where(eq(contacts.id, id))
            .limit(1);
          assertRowExists(before ? [before] : [], "contact");

          const updated = await tx
            .update(contacts)
            .set({ companyId })
            .where(eq(contacts.id, id))
            .returning({ id: contacts.id });
          assertRowExists(updated, "contact");

          if (before.companyId === companyId) return null;

          // The employer changed, so any `reports_to` link is now cross-company —
          // invalid by the rule `assertValidContactRelationship` enforces on
          // write. Drop it rather than leave a row the write path would reject.
          // The inline field warns before confirming, so this isn't a surprise.
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
          return {
            previousCompanyId: before.companyId,
            droppedManagerId: removed[0]?.relatedContactId ?? null,
          };
        });

        if (moved) {
          // Both companies list this person under Contacts, so both go stale.
          for (const affected of new Set([
            moved.previousCompanyId,
            companyId,
          ])) {
            if (affected !== null) revalidateCompany(affected);
          }
          // The dropped link also rendered on the ex-manager's page, under
          // Direct reports.
          if (moved.droppedManagerId !== null) {
            revalidateContactRelationship(id, moved.droppedManagerId);
          }
        }
        break;
      }
      case "relationshipStrength":
        await setContact({
          relationshipStrength: parsedInput.relationshipStrength,
        });
        break;
    }

    revalidateContact(id);
    return { id };
  });
