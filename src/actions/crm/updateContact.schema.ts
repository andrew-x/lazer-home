import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import { contactFields } from "./createContact.schema";

/**
 * Contact edit input — a pure, client-importable module (no `db`/drizzle) so the
 * edit dialog's resolver and the server action share one schema.
 *
 * Deliberately **not** the whole record: the dialog now owns only the identity
 * block (names, job title, active/inactive), and every other attribute — email,
 * phone, LinkedIn, employer, location, owner, relationship strength — is edited in
 * place in the sidebar through `updateContactField`. So the fields it doesn't own
 * aren't listed here at all, rather than round-tripped as hidden defaults: a
 * scoped save can't clobber a value someone changed inline while the dialog sat
 * open. The name/role refinements are still the shared `contactFields` objects, so
 * create and edit can't drift.
 */
export const updateContactSchema = z.object({
  id,
  firstName: contactFields.firstName,
  lastName: contactFields.lastName,
  role: contactFields.role,
  // Whether they're still someone we deal with. Edited here in the contact dialog
  // (create has no equivalent — a brand-new contact is always active), and also
  // set automatically on the *predecessor* when a successor record is linked, by
  // `createContactRelationship`.
  isActive: z.boolean(),
});

export type UpdateContactInput = z.input<typeof updateContactSchema>;
