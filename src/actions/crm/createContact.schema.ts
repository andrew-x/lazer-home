import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { contacts } from "@/lib/db/schema";
import { optionalText } from "@/lib/text-schema";

/**
 * Contact create input. Built from the Drizzle insert schema — the `contacts`
 * table is the single source of truth for which columns exist — with the
 * user-facing fields refined: required trimmed names, a normalised email, the
 * shared optional-text validators for phone/role, and an optional company link.
 * `id`/timestamps are DB-managed and omitted.
 */
export const createContactSchema = createInsertSchema(contacts)
  .pick({
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    companyId: true,
    role: true,
  })
  .extend({
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
    companyId: z.string().min(1).nullable().default(null),
    // Optional free-text job title.
    role: optionalText(100),
  });

export type CreateContactInput = z.input<typeof createContactSchema>;
