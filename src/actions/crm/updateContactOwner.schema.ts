import { createUpdateSchema } from "drizzle-zod";
import type { z } from "zod";
import { contacts } from "@/lib/db/schema";
import { id } from "@/lib/id-schema";

/**
 * Owner-only contact update. A deliberately narrow counterpart to
 * `updateContactSchema`: the inline owner field on the contact page changes just
 * the owner, so it targets `contacts.ownerId` alone rather than re-sending the
 * whole record (which would also re-run the manager rule and re-normalise the
 * email on an unrelated edit). `ownerId` is a staff id, or null to unassign.
 * Lives in its own file so the client component can import it (never export
 * schemas from a "use server" file).
 */
export const updateContactOwnerSchema = createUpdateSchema(contacts)
  .pick({ ownerId: true })
  .extend({
    id,
    ownerId: id.nullable().default(null),
  });

export type UpdateContactOwnerInput = z.input<typeof updateContactOwnerSchema>;
