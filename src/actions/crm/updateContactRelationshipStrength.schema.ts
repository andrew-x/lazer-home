import { z } from "zod";
import {
  RELATIONSHIP_STRENGTH_MAX,
  RELATIONSHIP_STRENGTH_MIN,
} from "@/lib/crm/relationship-strength";
import { id } from "@/lib/schemas/id-schema";

/**
 * Relationship-strength-only contact update. The narrow counterpart to
 * `updateContactSchema` behind the inline star rating on the contact page: it
 * targets just `contacts.relationshipStrength` so a rating change doesn't re-send
 * the whole record (which would re-run the manager rule and re-normalise the
 * email). Clicking a star always sets a concrete 1–5 level — there's no "clear"
 * affordance — so the value is a required integer in range, never null. Lives in
 * its own file so the client component can import it (never export schemas from a
 * "use server" file).
 */
export const updateContactRelationshipStrengthSchema = z.object({
  id,
  relationshipStrength: z
    .number()
    .int()
    .min(RELATIONSHIP_STRENGTH_MIN)
    .max(RELATIONSHIP_STRENGTH_MAX),
});

export type UpdateContactRelationshipStrengthInput = z.input<
  typeof updateContactRelationshipStrengthSchema
>;
