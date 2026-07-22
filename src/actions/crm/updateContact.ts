"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { contacts } from "@/lib/db/schema";
import { assertValidManager, mapContactEmailConflict } from "./contactChecks";
import { updateContactSchema } from "./updateContact.schema";

/**
 * Edit a contact's identity, links, employer, manager and owner. Gated on
 * `crm.edit` — the single CRM-write capability. Re-checks the manager rule
 * (an existing contact at the same company, never the contact itself) that the
 * picker enforces in the UI, so a hand-crafted request can't create a
 * cross-company, self-referential, or dangling management link. `.returning()`
 * detects a row deleted out from under the edit.
 */
export const updateContact = secureActionClient
  .metadata({
    action: "update-contact",
    permission: { crm: ["edit"] },
  })
  .inputSchema(updateContactSchema)
  .action(async ({ parsedInput }) => {
    const { id } = parsedInput;

    await assertValidManager({
      managerId: parsedInput.managerId,
      companyId: parsedInput.companyId,
      selfId: id,
    });

    let updated: { id: string }[];
    try {
      updated = await db
        .update(contacts)
        .set({
          firstName: parsedInput.firstName,
          lastName: parsedInput.lastName,
          email: parsedInput.email,
          phone: parsedInput.phone,
          companyId: parsedInput.companyId,
          role: parsedInput.role,
          linkedinUrl: parsedInput.linkedinUrl,
          managerId: parsedInput.managerId,
          ownerId: parsedInput.ownerId,
          relationshipStrength: parsedInput.relationshipStrength,
        })
        .where(eq(contacts.id, id))
        .returning({ id: contacts.id });
    } catch (error) {
      mapContactEmailConflict(error);
    }

    if (updated.length === 0) {
      throw new UserSafeActionError("That contact no longer exists.");
    }

    revalidatePath("/contacts");
    revalidatePath(`/contacts/${id}`);
    return { id };
  });
