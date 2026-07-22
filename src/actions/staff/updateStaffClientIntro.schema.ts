import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import { optionalTrimmedText } from "@/lib/schemas/text-schema";

/**
 * Client intro edit input — a pure, client-importable module (no `db`/drizzle)
 * so the edit form's resolver and the server action share one schema. Empty
 * (cleared) maps to null via the shared optional-trimmed-text validator.
 */
export const updateStaffClientIntroSchema = z.object({
  staffId: id,
  clientIntro: optionalTrimmedText(
    2000,
    "Keep the intro under 2000 characters.",
  ),
});

export type UpdateStaffClientIntroInput = z.input<
  typeof updateStaffClientIntroSchema
>;
