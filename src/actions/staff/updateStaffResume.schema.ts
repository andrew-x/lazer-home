import { z } from "zod";

/**
 * Resume edit input. Empty (cleared) maps to null. Lives in its own file so the
 * edit form can import it for the resolver (never export schemas from a "use
 * server" file).
 */
export const updateStaffResumeSchema = z.object({
  staffId: z.string().min(1),
  resume: z
    .string()
    .trim()
    .max(50_000, "Keep the resume under 50,000 characters.")
    .transform((value) => (value === "" ? null : value)),
});

export type UpdateStaffResumeInput = z.input<typeof updateStaffResumeSchema>;
