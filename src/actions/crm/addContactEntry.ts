"use server";

import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { contactEntries } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { addContactEntrySchema } from "./entries.schema";
import { resolveAuthorStaffId } from "./resolveAuthorStaffId";

/**
 * Append a timestamped note or next-step entry to a contact's log. Gated on
 * `crm.edit`. The author is resolved server-side from the session (never trusted
 * from the client); `createdAt` defaults to now. The contact FK is guarded by the
 * DB — a bad id surfaces as a clean error rather than a dangling row.
 */
export const addContactEntry = secureActionClient
  .metadata({ action: "add-contact-entry", permission: { crm: ["edit"] } })
  .inputSchema(addContactEntrySchema)
  .action(async ({ parsedInput, ctx }) => {
    const authorStaffId = await resolveAuthorStaffId(ctx.user);
    const entryId = generateId("centry");
    try {
      await db.insert(contactEntries).values({
        id: entryId,
        contactId: parsedInput.contactId,
        kind: parsedInput.kind,
        body: parsedInput.body,
        authorStaffId,
      });
    } catch {
      throw new UserSafeActionError("That contact no longer exists.");
    }

    revalidatePath(`/contacts/${parsedInput.contactId}`);
    revalidatePath("/contacts");
    return { id: entryId };
  });
