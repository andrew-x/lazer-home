import { z } from "zod";
import { id, ownerId } from "@/lib/schemas/id-schema";

/**
 * Field-scoped edit of a single company attribute from the detail page's inline
 * fields (owner, location).
 *
 * A discriminated union on `field`: each variant carries only the slice that
 * field owns, so an inline edit writes just what changed instead of re-sending
 * the whole record (which last-write-wins clobbers a concurrent edit). Mirrors
 * `updateOpportunityFieldSchema`. A pure, client-importable module (no
 * `db`/drizzle) so the inline field components and the action share one schema.
 */
export const updateCompanyFieldSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("owner"), id, ownerId }),
  z.object({
    field: z.literal("location"),
    id,
    location: z.string().min(1).nullable(),
  }),
]);

export type UpdateCompanyFieldInput = z.input<typeof updateCompanyFieldSchema>;
