"use server";

import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { contacts } from "@/lib/db/schema";
import { assertValidManager, mapContactEmailConflict } from "./contactChecks";
import { createContactSchema } from "./createContact.schema";

/**
 * Create a contact, optionally linked to an existing company. Gated on
 * `crm.edit` — the single CRM-write capability. (A brand-new company is created
 * separately via `createCompany` before this runs — see `CompanyComboboxField`.)
 */
export const createContact = secureActionClient
  .metadata({
    action: "create-contact",
    permission: { crm: ["edit"] },
  })
  .inputSchema(createContactSchema)
  .action(async ({ parsedInput }) => {
    // A manager must be an existing contact at the *same* company. The picker
    // enforces this in the UI, but re-check server-side so a hand-crafted request
    // can't create a cross-company (or dangling) management link.
    await assertValidManager({
      managerId: parsedInput.managerId,
      companyId: parsedInput.companyId,
    });

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
        managerId: parsedInput.managerId,
      });
    } catch (error) {
      mapContactEmailConflict(error);
    }

    revalidatePath("/contacts");
    return { id: contactId };
  });
