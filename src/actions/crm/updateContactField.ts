"use server";

import { eq, type InferInsertModel } from "drizzle-orm";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { contacts } from "@/lib/db/schema";
import { revalidateContact } from "./revalidate";
import { updateContactFieldSchema } from "./updateContactField.schema";

type ContactUpdate = Partial<InferInsertModel<typeof contacts>>;

/**
 * Edit a *single* field of a contact from its detail page's inline fields
 * (owner, location, relationship strength). Gated on `crm.edit`. A discriminated
 * union on `field`: each variant writes only the slice that changed instead of
 * re-sending the whole record — so a concurrent edit to another field isn't
 * clobbered and the manager rule / email normalisation aren't re-run on an
 * unrelated change (mirrors `updateOpportunityField`). Every write is
 * `.returning()`-guarded so a row deleted out from under the edit surfaces as a
 * clean error.
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
      case "relationshipStrength":
        await setContact({
          relationshipStrength: parsedInput.relationshipStrength,
        });
        break;
    }

    revalidateContact(id);
    return { id };
  });
