import { createUpdateSchema } from "drizzle-zod";
import { z } from "zod";
import { contacts } from "@/lib/db/schema";
import { id } from "@/lib/id-schema";
import { optionalText } from "@/lib/text-schema";
import { optionalUrl } from "@/lib/url-schema";

/**
 * Contact edit input. Built from the Drizzle update schema — the `contacts`
 * table is the single source of truth for which columns exist — with the same
 * user-facing refinements as create (required trimmed names, normalised email,
 * optional phone/role/company/manager) plus an optional owner (a staff id) and
 * the `id` targeting the row. Lives in its own file so the edit form can import
 * it for the resolver (never export schemas from a "use server" file).
 */
export const updateContactSchema = createUpdateSchema(contacts)
  .pick({
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    companyId: true,
    role: true,
    linkedinUrl: true,
    managerId: true,
    ownerId: true,
  })
  .extend({
    id,
    firstName: z.string().trim().min(1, "First name is required.").max(100),
    lastName: z.string().trim().min(1, "Last name is required.").max(100),
    // Normalised to lowercase so the (case-sensitive) unique constraint treats
    // John@Acme.com and john@acme.com as the same contact.
    email: z
      .string()
      .trim()
      .pipe(z.email("Enter a valid email."))
      .transform((value) => value.toLowerCase()),
    phone: optionalText(30),
    companyId: id.nullable().default(null),
    role: optionalText(100),
    linkedinUrl: optionalUrl,
    // Optional "managed by" contact id. Must be a contact at the same company
    // (and not the contact itself); that cross-field rule is enforced in the
    // action (needs a DB lookup).
    managerId: id.nullable().default(null),
    // Optional owner — an existing staff id, or null to unassign.
    ownerId: id.nullable().default(null),
  });

export type UpdateContactInput = z.input<typeof updateContactSchema>;
