import { z } from "zod";
import { id, ownerId } from "@/lib/schemas/id-schema";
import { contactFields } from "./createContact.schema";

/**
 * Contact edit input — a pure, client-importable module (no `db`/drizzle) so the
 * edit form's resolver and the server action share one schema. Reuses the same
 * shared `contactFields` refinements as create (so the two can't drift) plus an
 * optional owner, the `id` targeting the row, the current relationship strength
 * carried through the edit, and the active/inactive status.
 */
export const updateContactSchema = z.object({
  ...contactFields,
  id,
  ownerId,
  // Whether they're still someone we deal with. Edited here in the contact dialog
  // (create has no equivalent — a brand-new contact is always active), and also
  // set automatically on the *predecessor* when a successor record is linked, by
  // `createContactRelationship`.
  isActive: z.boolean(),
  // Relationship strength (1–5) is edited inline via `updateContactField`'s
  // `relationshipStrength` variant; the edit form just carries the current
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
