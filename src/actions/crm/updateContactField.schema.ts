import { z } from "zod";
import {
  RELATIONSHIP_STRENGTH_MAX,
  RELATIONSHIP_STRENGTH_MIN,
} from "@/lib/crm/relationship-strength";
import { id, ownerId } from "@/lib/schemas/id-schema";
import { contactFields } from "./createContact.schema";

/**
 * Field-scoped edit of a single contact attribute from the detail page's inline
 * fields — email, phone, LinkedIn, employer, location, owner and relationship
 * strength. Everything in the sidebar is edited through here; the contact dialog
 * (`updateContactSchema`) is left with the identity block only.
 *
 * A discriminated union on `field`: each variant carries only the slice that
 * field owns, so an inline edit writes just what changed instead of re-sending
 * the whole record (which would also re-normalise the email on an unrelated
 * change). Mirrors `updateOpportunityFieldSchema`.
 *
 * The user-facing field refinements are the *same objects* as create/update use
 * (`contactFields`), so an inline edit can't drift from the dialog's validation —
 * email is still lowercased, LinkedIn still gets its scheme filled in, and a blank
 * phone still becomes null. Relationship strength is always a concrete 1–5 level —
 * clicking a star sets it, there's no "clear" affordance — so it's a required
 * integer in range, never null. A pure, client-importable module (no
 * `db`/drizzle) so the inline field components and the action share one schema.
 */
export const updateContactFieldSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("owner"), id, ownerId }),
  z.object({
    field: z.literal("location"),
    id,
    location: z.string().min(1).nullable(),
  }),
  z.object({ field: z.literal("email"), id, email: contactFields.email }),
  z.object({ field: z.literal("phone"), id, phone: contactFields.phone }),
  z.object({
    field: z.literal("linkedinUrl"),
    id,
    linkedinUrl: contactFields.linkedinUrl,
  }),
  // The employer. Nullable — an unknown employer is a legitimate state, so the
  // picker is clearable. Changing it has a side effect on relationships; see the
  // `company` case in `updateContactField`.
  z.object({
    field: z.literal("company"),
    id,
    companyId: contactFields.companyId,
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
  // No `isActive` variant: active/inactive is edited in the contact dialog via
  // `updateContactSchema`, not inline on the page.
]);

export type UpdateContactFieldInput = z.input<typeof updateContactFieldSchema>;
