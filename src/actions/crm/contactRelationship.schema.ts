import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import { requiredText } from "@/lib/schemas/text-schema";

/**
 * Validation for contact ↔ contact relationships. A pure, client-importable
 * module (no `db`/drizzle) so the relationships dialog and the three actions
 * share one schema.
 *
 * A **discriminated union on `kind`**, because `description` belongs to exactly
 * one kind: `related` requires it, the two directional kinds forbid it (parsed to
 * a hard `null` so the writer can pass the field unconditionally). The DB CHECK
 * `contact_relationships_description_kind` is the backstop; this is where the
 * user-facing message lives.
 *
 * Cross-row rules — same-company for `reports_to`, different-company for
 * `succeeds`, and cycle prevention — need DB lookups and live in
 * `contactRelationshipChecks.ts`.
 *
 * `description` is free text: the suggestions in `@/lib/crm/contact-relationship`
 * are UI hints and are deliberately *not* validated against, so a novel wording
 * is accepted (same stance as `companyContactRelationship.schema.ts`).
 */
export const CONTACT_RELATION_DESCRIPTION_MAX_LENGTH = 120;

const relationDescription = requiredText(
  CONTACT_RELATION_DESCRIPTION_MAX_LENGTH,
  "Describe how they know each other.",
);

const endpoints = {
  /** The owning side. For `succeeds` this is the NEW (current) record. */
  contactId: id,
  /** The other side. For `succeeds` this is the OLD (predecessor) record. */
  relatedContactId: id,
};

export const createContactRelationshipSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("reports_to"),
      ...endpoints,
      // Accepts an omitted field or an explicit null, rejects a string, and always
      // yields `null` after parse — so the action can write `description` blind.
      description: z.null().default(null),
    }),
    z.object({
      kind: z.literal("succeeds"),
      ...endpoints,
      description: z.null().default(null),
    }),
    z.object({
      kind: z.literal("related"),
      ...endpoints,
      description: relationDescription,
    }),
  ])
  // Cheap enough to catch here rather than as an opaque CHECK violation; the
  // pickers pass `excludeId`, so it should be unreachable from the UI.
  .refine((value) => value.contactId !== value.relatedContactId, {
    message: "A contact can't be linked to themselves.",
    path: ["relatedContactId"],
  });
export type CreateContactRelationshipInput = z.input<
  typeof createContactRelationshipSchema
>;

/**
 * Only a `related` link has anything editable. The endpoints *and* the kind are
 * immutable — re-point or re-type a link by deleting and re-adding it (mirrors
 * `updateCompanyContactRelationshipSchema`).
 */
export const updateContactRelationshipSchema = z.object({
  id,
  description: relationDescription,
});
export type UpdateContactRelationshipInput = z.input<
  typeof updateContactRelationshipSchema
>;

export const deleteContactRelationshipSchema = z.object({ id });
export type DeleteContactRelationshipInput = z.input<
  typeof deleteContactRelationshipSchema
>;
