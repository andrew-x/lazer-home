import { z } from "zod";
import { createCompanySchema } from "./createCompany.schema";

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
  // Optional employer, set one of two ways: link an existing company by id...
  companyId: z.string().min(1).nullable().default(null),
  // ...or create a new company inline; the action persists both at once. When
  // `newCompany` is present the action ignores `companyId`.
  newCompany: createCompanySchema.nullish(),
  // Optional free-text job title.
  role: optionalText(100),
});

export type CreateContactInput = z.input<typeof createContactSchema>;
