import { z } from "zod";

// NUL byte (U+0000). Postgres `text` columns can't store it, and PDF text
// extraction can leave it embedded — strip it before persisting. Built via
// fromCharCode to keep a literal NUL out of source.
const NUL = String.fromCharCode(0);

/**
 * Resume edit input. Empty (cleared) maps to null. Lives in its own file so the
 * edit form can import it for the resolver (never export schemas from a "use
 * server" file).
 */
export const updateStaffResumeSchema = z.object({
  staffId: z.string().min(1),
  resume: z
    .string()
    .max(50_000, "Keep the resume under 50,000 characters.")
    .transform((value) => {
      const cleaned = value.split(NUL).join("").trim();
      return cleaned === "" ? null : cleaned;
    }),
});

export type UpdateStaffResumeInput = z.input<typeof updateStaffResumeSchema>;
