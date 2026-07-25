import { z } from "zod";
import {
  RELATIONSHIP_STRENGTH_MAX,
  RELATIONSHIP_STRENGTH_MIN,
} from "@/lib/crm/relationship-strength";
import { id, ownerId } from "@/lib/schemas/id-schema";

/**
 * Field-scoped edit of a single contact attribute from the detail page's inline
 * fields (owner, location, relationship strength).
 *
 * A discriminated union on `field`: each variant carries only the slice that
 * field owns, so an inline edit writes just what changed instead of re-sending
 * the whole record (which would also re-run the manager rule and re-normalise
 * the email on an unrelated change). Mirrors `updateOpportunityFieldSchema`.
 * Relationship strength is always a concrete 1–5 level — clicking a star sets
 * it, there's no "clear" affordance — so it's a required integer in range,
 * never null. A pure, client-importable module (no `db`/drizzle) so the inline
 * field components and the action share one schema.
 */
export const updateContactFieldSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("owner"), id, ownerId }),
  z.object({
    field: z.literal("location"),
    id,
    location: z.string().min(1).nullable(),
  }),
  z.object({
    field: z.literal("relationshipStrength"),
    id,
    relationshipStrength: z
      .number()
      .int()
      .min(RELATIONSHIP_STRENGTH_MIN)
      .max(RELATIONSHIP_STRENGTH_MAX),
  }),
]);

export type UpdateContactFieldInput = z.input<typeof updateContactFieldSchema>;
