import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import { optionalText } from "@/lib/schemas/text-schema";
import { optionalUrl } from "@/lib/schemas/url-schema";

/**
 * A pure, client-importable module (no `db`/drizzle) so the create/edit contact
 * forms' resolvers and the server actions share one schema. See the "schema
 * modules by boundary" rule in `.claude/rules/server-actions.md`.
 */

/**
 * The user-facing contact field refinements shared by create and update:
 * required trimmed names, a normalised (lowercased) email, and the optional
 * phone/company/role/LinkedIn/manager fields. Spread into both schemas'
 * `.extend(...)` so the two can't drift (mirrors `opportunityBaseFields`); update
 * layers `id` and `ownerId` on top. The manager cross-field rule (same company,
 * not self) needs a DB lookup and is enforced in the action.
 */
export const contactFields = {
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
  // Optional employer — link an existing company by id (a new company is
  // created separately via `createCompany` first, then passed here as
  // `companyId`).
  companyId: id.nullable().default(null),
  // Optional free-text job title.
  role: optionalText(100),
  // Optional LinkedIn profile URL — normalised/validated like other links.
  linkedinUrl: optionalUrl,
  // Optional "managed by" contact id. Must be a contact at the same company;
  // that cross-field rule is enforced in the action (needs a DB lookup).
  managerId: id.nullable().default(null),
};

/**
 * Contact create input — the shared `contactFields` refinements as their own
 * object. `id`/timestamps are DB-managed and omitted.
 */
export const createContactSchema = z.object(contactFields);

export type CreateContactInput = z.input<typeof createContactSchema>;
