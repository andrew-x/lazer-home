"use server";

import { eq } from "drizzle-orm";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { contactRelationships, contacts } from "@/lib/db/schema";
import { createContactRelationshipSchema } from "./contactRelationship.schema";
import {
  assertValidContactRelationship,
  mapContactRelationshipConflict,
  type RelationshipEndpointCompanies,
} from "./contactRelationshipChecks";
import { revalidateCompany, revalidateContactRelationship } from "./revalidate";

/**
 * Link two contacts: a manager (`reports_to`), the same person's earlier record at
 * a previous employer (`succeeds`), or any other tie (`related`, with free text).
 *
 * Gated on `crm.edit` — the single CRM-write capability, same as every other CRM
 * mutation. Note for the RBAC audit: a `succeeds` link also writes
 * `contacts.isActive`, and `crm.edit` is *already* the capability
 * `updateContactField` requires to write that same column, so this is no
 * escalation. Callable from either contact's page, so it revalidates both.
 */
export const createContactRelationship = secureActionClient
  .metadata({
    action: "create-contact-relationship",
    permission: { crm: ["edit"] },
  })
  .inputSchema(createContactRelationshipSchema)
  .action(async ({ parsedInput }) => {
    const { kind, contactId, relatedContactId, description } = parsedInput;
    const relationshipId = generateId("crel");

    let endpoints: RelationshipEndpointCompanies;
    try {
      // One transaction so the cross-row checks read the same snapshot the insert
      // writes into, and so a `succeeds` link and the predecessor's deactivation
      // can't half-apply. The `try` wraps the *transaction* call, not the inner
      // insert: postgres.js rolls back and rethrows the original `PostgresError`
      // from here, which is what `pgErrorFields`' cause-walk needs to see.
      endpoints = await db.transaction(async (tx) => {
        const resolved = await assertValidContactRelationship(tx, {
          kind,
          contactId,
          relatedContactId,
        });

        await tx.insert(contactRelationships).values({
          id: relationshipId,
          kind,
          contactId,
          relatedContactId,
          // Always null except for `related` — the schema's discriminated union
          // guarantees it, and a DB CHECK backs it up.
          description,
        });

        // A succession says the predecessor record is history: the same human is
        // now the `contactId` row at their new employer. Marking them inactive here
        // rather than expecting a second call keeps the two facts atomic — there is
        // no state where the chain exists but the old record still shows up in the
        // pickers and the default contacts list.
        if (kind === "succeeds") {
          await tx
            .update(contacts)
            .set({ isActive: false })
            .where(eq(contacts.id, relatedContactId));
        }

        return resolved;
      });
    } catch (error) {
      // Rethrows anything it doesn't recognise, including the checks'
      // `UserSafeActionError`s, which pass through the transaction unchanged.
      mapContactRelationshipConflict(error);
    }

    revalidateContactRelationship(contactId, relatedContactId);
    // A `succeeds` link flips `isActive`, which also renders in the employers'
    // contact tables — refresh those company pages when we know them.
    if (kind === "succeeds") {
      if (endpoints.relatedCompanyId) {
        revalidateCompany(endpoints.relatedCompanyId);
      }
      if (endpoints.contactCompanyId) {
        revalidateCompany(endpoints.contactCompanyId);
      }
    }
    return { id: relationshipId };
  });
