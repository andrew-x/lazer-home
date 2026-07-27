import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import { requiredText } from "@/lib/schemas/text-schema";

/**
 * Shared validation for timestamped note entries (contacts, companies, and
 * opportunities alike). A pure, client-importable module so the composer forms
 * and the actions share one schema. (The old "next step" kind on these logs was
 * replaced by the `tasks` entity — see `tasks.schema.ts`.)
 */
export const NOTE_MAX_LENGTH = 5000;

const body = requiredText(NOTE_MAX_LENGTH);

export const addContactEntrySchema = z.object({ contactId: id, body });
export type AddContactEntryInput = z.input<typeof addContactEntrySchema>;

export const addOpportunityEntrySchema = z.object({ opportunityId: id, body });
export type AddOpportunityEntryInput = z.input<
  typeof addOpportunityEntrySchema
>;

export const addCompanyEntrySchema = z.object({ companyId: id, body });
export type AddCompanyEntryInput = z.input<typeof addCompanyEntrySchema>;

// Updates carry only the new body; the action never changes an entry's parent.
export const updateEntrySchema = z.object({ id, body });
export type UpdateEntryInput = z.input<typeof updateEntrySchema>;

export const deleteEntrySchema = z.object({ id });
export type DeleteEntryInput = z.input<typeof deleteEntrySchema>;
