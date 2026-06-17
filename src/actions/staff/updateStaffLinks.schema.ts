import { z } from "zod";

/**
 * A profile URL field: an empty string (cleared) maps to null, otherwise it must
 * be a valid URL. Lives in its own file so the edit form can import it for the
 * resolver (never export schemas from a "use server" file).
 */
const optionalUrl = z
  .union([z.literal(""), z.url("Enter a valid URL (including https://).")])
  .transform((value) => (value === "" ? null : value));

export const updateStaffLinksSchema = z.object({
  staffId: z.string().min(1),
  linkedinUrl: optionalUrl,
  githubUrl: optionalUrl,
  portfolioUrl: optionalUrl,
});

export type UpdateStaffLinksInput = z.input<typeof updateStaffLinksSchema>;
