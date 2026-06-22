"use server";

import { revalidatePath } from "next/cache";
import { type ActionAuthorize, secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { companies, contacts } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions";
import { createContactSchema } from "./createContact.schema";

/** True for a Postgres unique violation (SQLSTATE 23505) on a specific named
 * constraint, so we only translate the violations we actually expect. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; constraint_name?: unknown };
  return e.code === "23505" && e.constraint_name === constraint;
}

/**
 * Creating a contact requires `contacts.create` (static gate below). Creating a
 * company inline at the same time additionally requires `companies.create` —
 * input-dependent, so it's enforced here off the raw client input.
 */
const authorizeInlineCompany: ActionAuthorize = ({ user, clientInput }) => {
  const input = clientInput as { newCompany?: unknown } | undefined;
  if (input?.newCompany) {
    requirePermission(user, { companies: ["create"] });
  }
};

/** Create a contact, optionally creating its company inline (one transaction). */
export const createContact = secureActionClient
  .metadata({
    action: "create-contact",
    permission: { contacts: ["create"] },
    authorize: authorizeInlineCompany,
  })
  .inputSchema(createContactSchema)
  .action(async ({ parsedInput }) => {
    try {
      await db.transaction(async (tx) => {
        let companyId = parsedInput.companyId;

        if (parsedInput.newCompany) {
          const [company] = await tx
            .insert(companies)
            .values({
              id: generateId("company"),
              name: parsedInput.newCompany.name,
              websiteUrl: parsedInput.newCompany.websiteUrl,
              isPartner: parsedInput.newCompany.isPartner,
            })
            .returning({ id: companies.id });
          companyId = company.id;
        }

        await tx.insert(contacts).values({
          id: generateId("contact"),
          firstName: parsedInput.firstName,
          lastName: parsedInput.lastName,
          email: parsedInput.email,
          phone: parsedInput.phone,
          companyId,
          role: parsedInput.role,
        });
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
    return { ok: true };
  });
