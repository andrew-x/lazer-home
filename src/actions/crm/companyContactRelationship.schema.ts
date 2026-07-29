import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import { requiredText } from "@/lib/schemas/text-schema";

/**
 * Validation for non-employee company ↔ contact relationships. A pure,
 * client-importable module (no `db`/drizzle) so the relationship dialog and the
 * three actions share one schema.
 *
 * `description` is free text — the suggestions in
 * `@/lib/crm/company-contact-relationship` are UI hints and are deliberately
 * *not* validated against, so a novel wording ("Fractional CTO") is accepted.
 */
export const RELATIONSHIP_DESCRIPTION_MAX_LENGTH = 120;

const description = requiredText(
  RELATIONSHIP_DESCRIPTION_MAX_LENGTH,
  "Describe the relationship.",
);

export const createCompanyContactRelationshipSchema = z.object({
  companyId: id,
  contactId: id,
  description,
});
export type CreateCompanyContactRelationshipInput = z.input<
  typeof createCompanyContactRelationshipSchema
>;

// Updates carry only the description: the two endpoints are immutable, so
// re-pointing a relationship means deleting and re-adding it (mirrors
// `updateEntrySchema`, which likewise never moves an entry's parent).
export const updateCompanyContactRelationshipSchema = z.object({
  id,
  description,
});
export type UpdateCompanyContactRelationshipInput = z.input<
  typeof updateCompanyContactRelationshipSchema
>;

export const deleteCompanyContactRelationshipSchema = z.object({ id });
export type DeleteCompanyContactRelationshipInput = z.input<
  typeof deleteCompanyContactRelationshipSchema
>;
