import { createUpdateSchema } from "drizzle-zod";
import type { z } from "zod";
import { staff } from "@/lib/db/schema";
import { id } from "@/lib/id-schema";
import { optionalTrimmedText } from "@/lib/text-schema";

/**
 * Client intro edit input. Empty (cleared) maps to null. Built from the Drizzle
 * update schema (the `staff` table is the source of truth for its columns), with
 * `clientIntro` refined by the shared optional-trimmed-text validator. Lives in
 * its own file so the edit form can import it for the resolver (never export
 * schemas from a "use server" file).
 */
export const updateStaffClientIntroSchema = createUpdateSchema(staff)
  .pick({ clientIntro: true })
  .extend({
    staffId: id,
    clientIntro: optionalTrimmedText(
      2000,
      "Keep the intro under 2000 characters.",
    ),
  });

export type UpdateStaffClientIntroInput = z.input<
  typeof updateStaffClientIntroSchema
>;
