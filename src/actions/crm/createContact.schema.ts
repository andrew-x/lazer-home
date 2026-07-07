import { z } from "zod";

/** Empty/whitespace optional text → null; otherwise trimmed. Accepts null on
 * input too, so re-parsing the transformed value (client → server) is stable. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    });

export const createContactSchema = z.object({
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
  // Optional employer — link an existing company by id (a new company is created
  // separately via `createCompany` first, then passed here as `companyId`).
  companyId: z.string().min(1).nullable().default(null),
  // Optional free-text job title.
  role: optionalText(100),
});

export type CreateContactInput = z.input<typeof createContactSchema>;
