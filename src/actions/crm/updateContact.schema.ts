import { z } from "zod";
import { id, ownerId } from "@/lib/id-schema";
import { contactFields } from "./createContact.schema";

/**
 * Contact edit input — a pure, client-importable module (no `db`/drizzle) so the
 * edit form's resolver and the server action share one schema. Reuses the same
 * shared `contactFields` refinements as create (so the two can't drift) plus an
 * optional owner, the `id` targeting the row, and the current relationship
 * strength carried through the edit.
 */
export const updateContactSchema = z.object({
  ...contactFields,
  id,
  ownerId,
  // Relationship strength (1–5) is edited inline via
  // `updateContactRelationshipStrength`; the edit form just carries the current
  // value through. A nullable int32 (null when unrated) — matches the column.
  relationshipStrength: z
    .number()
    .int()
    .min(-2147483648)
    .max(2147483647)
    .nullable()
    .optional(),
});

export type UpdateContactInput = z.input<typeof updateContactSchema>;
