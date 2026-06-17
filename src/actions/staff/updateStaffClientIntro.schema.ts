import { z } from "zod";

/**
 * Client intro edit input. Empty (cleared) maps to null. Lives in its own file so
 * the edit form can import it for the resolver (never export schemas from a "use
 * server" file).
 */
export const updateStaffClientIntroSchema = z.object({
  staffId: z.string().min(1),
  clientIntro: z
    .string()
    .trim()
    .max(2000, "Keep the intro under 2000 characters.")
    .transform((value) => (value === "" ? null : value)),
});

export type UpdateStaffClientIntroInput = z.input<
  typeof updateStaffClientIntroSchema
>;
