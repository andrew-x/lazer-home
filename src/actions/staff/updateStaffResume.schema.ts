import { z } from "zod";
import { id } from "@/lib/id-schema";

// NUL byte (U+0000). Postgres `text` columns can't store it, and PDF text
// extraction can leave it embedded — strip it before persisting. Built via
// fromCharCode to keep a literal NUL out of source.
const NUL = String.fromCharCode(0);

/**
 * Resume edit input — a pure, client-importable module (no `db`/drizzle) so the
 * edit form's resolver and the server action share one schema. Empty (cleared)
 * maps to null; `resume` strips NUL bytes and caps length.
 */
export const updateStaffResumeSchema = z.object({
  staffId: id,
  resume: z
    .string()
    .max(50_000, "Keep the resume under 50,000 characters.")
    .transform((value) => {
      const cleaned = value.split(NUL).join("").trim();
      return cleaned === "" ? null : cleaned;
    }),
});

export type UpdateStaffResumeInput = z.input<typeof updateStaffResumeSchema>;
