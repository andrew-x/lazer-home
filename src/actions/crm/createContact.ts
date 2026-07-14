"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { contacts } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/unique-violation";
import { UserSafeActionError } from "@/lib/errors";
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
    if (parsedInput.managerId !== null) {
      if (parsedInput.companyId === null) {
        throw new UserSafeActionError(
          "Set a company before choosing a manager.",
        );
      }
      const [manager] = await db
        .select({ companyId: contacts.companyId })
        .from(contacts)
        .where(eq(contacts.id, parsedInput.managerId))
        .limit(1);
      if (!manager || manager.companyId !== parsedInput.companyId) {
        throw new UserSafeActionError(
          "The manager must be a contact at the same company.",
        );
      }
    }

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
      if (isUniqueViolation(error, "contacts_email_unique")) {
        throw new UserSafeActionError(
          "A contact with that email already exists.",
        );
      }
      throw error;
    }

    revalidatePath("/contacts");
    return { id: contactId };
  });
