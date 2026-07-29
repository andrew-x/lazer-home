"use server";

import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { contacts } from "@/lib/db/schema";
import { mapContactEmailConflict } from "./contactChecks";
import { createContactSchema } from "./createContact.schema";

/**
 * Create a contact, optionally linked to an existing company. Gated on
 * `crm.edit` — the single CRM-write capability. (A brand-new company is created
 * separately via `createCompany` before this runs — see `CompanyComboboxField`.)
 *
 * Relationships (manager included) are **not** set here: they live in
 * `contact_relationships` and are added from the contact page's Relationships
 * section once the contact exists — see `createContactRelationship`.
 */
export const createContact = secureActionClient
  .metadata({
    action: "create-contact",
    permission: { crm: ["edit"] },
  })
  .inputSchema(createContactSchema)
  .action(async ({ parsedInput }) => {
    // Minted up front so the created id can be returned to callers (e.g. the
    // opportunity form's inline-create flow appends it to its selection).
    const contactId = generateId("contact");
    try {
      await db.insert(contacts).values({
        id: contactId,
        firstName: parsedInput.firstName,
        lastName: parsedInput.lastName,
        email: parsedInput.email,
        phone: parsedInput.phone,
        companyId: parsedInput.companyId,
        role: parsedInput.role,
        linkedinUrl: parsedInput.linkedinUrl,
      });
    } catch (error) {
      mapContactEmailConflict(error);
    }

    revalidatePath("/contacts");
    return { id: contactId };
  });
