"use server";

import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { contacts } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { createContactSchema } from "./createContact.schema";

/** True for a Postgres unique violation (SQLSTATE 23505) on a specific named
 * constraint, so we only translate the violations we actually expect. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; constraint_name?: unknown };
  return e.code === "23505" && e.constraint_name === constraint;
}

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
      });
    } catch (error) {
      if (isUniqueViolation(error, "contacts_email_unique")) {
        throw new UserSafeActionError(
          "A contact with that email already exists.",
        );
      }
      throw error;
    }

    revalidatePath("/companies");
    return { id: contactId };
  });
