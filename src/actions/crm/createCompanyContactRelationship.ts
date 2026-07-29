"use server";

import { eq } from "drizzle-orm";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { isForeignKeyViolation } from "@/lib/db/foreign-key-violation";
import { generateId } from "@/lib/db/ids";
import { companyContactRelationships, contacts } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/unique-violation";
import { createCompanyContactRelationshipSchema } from "./companyContactRelationship.schema";
import { revalidateCompanyContactRelationship } from "./revalidate";

/**
 * Link a contact to a company they *don't* work at, with a short description of
 * the relationship (e.g. a partner's "CSM"). Gated on `crm.edit` — the single
 * CRM-write capability. Callable from either detail page, so it revalidates both.
 */
export const createCompanyContactRelationship = secureActionClient
  .metadata({
    action: "create-company-contact-relationship",
    permission: { crm: ["edit"] },
  })
  .inputSchema(createCompanyContactRelationshipSchema)
  .action(async ({ parsedInput: { companyId, contactId, description } }) => {
    // This table is for *non-employee* relationships — employment lives on
    // `contacts.companyId`. The pickers filter employees out in the UI; re-check
    // here so a hand-crafted request can't duplicate the employer link (same
    // posture as `assertValidManager`).
    const [contact] = await db
      .select({ companyId: contacts.companyId })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    if (!contact) {
      throw new UserSafeActionError("That contact no longer exists.");
    }
    if (contact.companyId === companyId) {
      throw new UserSafeActionError(
        "That contact already works at this company — they're listed under Contacts.",
      );
    }

    const relationshipId = generateId("ccrel");
    try {
      await db.insert(companyContactRelationships).values({
        id: relationshipId,
        companyId,
        contactId,
        description,
      });
    } catch (error) {
      if (isUniqueViolation(error, "company_contact_relationships_unique")) {
        throw new UserSafeActionError(
          "That relationship already exists — edit the existing one instead.",
        );
      }
      // Either endpoint could have been deleted between the picker and submit.
      if (isForeignKeyViolation(error)) {
        throw new UserSafeActionError(
          "That company or contact no longer exists.",
        );
      }
      throw error;
    }

    revalidateCompanyContactRelationship(companyId, contactId);
    return { id: relationshipId };
  });
