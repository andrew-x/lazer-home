import { z } from "zod";
import { id } from "@/lib/id-schema";
import { requiredText } from "@/lib/text-schema";

/**
 * Shared validation for timestamped notes & next-step entries (contacts and
 * opportunities alike). A pure, client-importable module so the composer forms
 * and the actions share one schema. Notes and next steps differ only by length:
 * notes are longer prose, next steps are short reminders.
 */
export const ENTRY_KINDS = ["note", "next_step"] as const;
export const entryKindSchema = z.enum(ENTRY_KINDS);
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const NOTE_MAX_LENGTH = 5000;
export const NEXT_STEP_MAX_LENGTH = 500;

/** Max body length for a given kind — the tighter cap for next steps. */
export const maxLengthForKind = (kind: EntryKind) =>
  kind === "next_step" ? NEXT_STEP_MAX_LENGTH : NOTE_MAX_LENGTH;

// Validated against the larger cap here; the per-kind cap is enforced by
// `refineEntryBody` once `kind` is known (both `body` and `kind` are present).
const body = requiredText(NOTE_MAX_LENGTH);

/**
 * Enforce the per-kind length cap on a parsed `{ kind, body }`. `body` is already
 * trimmed by `requiredText`, so this measures the trimmed length.
 */
function refineEntryBody(
  val: { kind: EntryKind; body: string },
  ctx: z.RefinementCtx,
) {
  const max = maxLengthForKind(val.kind);
  if (val.body.length > max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["body"],
      message: `A next step can be at most ${max} characters.`,
    });
  }
}

export const addContactEntrySchema = z
  .object({ contactId: id, kind: entryKindSchema, body })
  .superRefine(refineEntryBody);
export type AddContactEntryInput = z.input<typeof addContactEntrySchema>;

export const addOpportunityEntrySchema = z
  .object({ opportunityId: id, kind: entryKindSchema, body })
  .superRefine(refineEntryBody);
export type AddOpportunityEntryInput = z.input<
  typeof addOpportunityEntrySchema
>;

// Updates carry `kind` only so the per-kind length cap can be validated; the
// action never changes an entry's kind or parent, just its body.
export const updateEntrySchema = z
  .object({ id, kind: entryKindSchema, body })
  .superRefine(refineEntryBody);
export type UpdateEntryInput = z.input<typeof updateEntrySchema>;

export const deleteEntrySchema = z.object({ id });
export type DeleteEntryInput = z.input<typeof deleteEntrySchema>;
