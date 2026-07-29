import { z } from "zod";
import {
  REVIEW_NOTE_BODY_MAX,
  REVIEW_NOTE_TITLE_MAX,
} from "@/lib/performance/review-note";
import { dateString } from "@/lib/schemas/date-schema";
import { id } from "@/lib/schemas/id-schema";
import { optionalText, requiredText } from "@/lib/schemas/text-schema";

/**
 * Shared validation for the performance-review-note family (create / update /
 * share / delete). A pure, client-importable module (no `db`/drizzle) so the
 * notes panel's forms and the actions share one schema.
 *
 * Note what is NOT here: `status` is never client-supplied. A note is born a
 * draft and becomes shared only through `shareReviewNote`, so the lifecycle can't
 * be skipped by posting a status.
 */

/** The editable content of a note, identical on create and update. */
export const reviewNoteFields = {
  /** The date of the conversation — not the date the note was typed. */
  noteDate: dateString,
  // `optionalText`, not `optionalTrimmedText`: it accepts null/undefined on input
  // as well, so the panel can hand a validated (already-null) title straight back
  // to the action without the round-trip failing re-validation.
  title: optionalText(
    REVIEW_NOTE_TITLE_MAX,
    `Keep the title under ${REVIEW_NOTE_TITLE_MAX} characters.`,
  ),
  body: requiredText(REVIEW_NOTE_BODY_MAX),
};

/**
 * Just the content — the resolver behind the notes panel's composer/editor, whose
 * form shape is the same whether it's creating or editing (the ids are added at
 * submit, not typed by the person). See `ReviewNoteFormValues`.
 */
export const reviewNoteContentSchema = z.object(reviewNoteFields);
/** What the form's fields hold while typing (`title` is "" when cleared). */
export type ReviewNoteContentInput = z.input<typeof reviewNoteContentSchema>;
/** What validation produces, and what the actions take (`title` is null when blank). */
export type ReviewNoteContentValues = z.output<typeof reviewNoteContentSchema>;

/** `staffId` is who the note is about — the input `authorizeReviewNoteCreate` gates on. */
export const createReviewNoteSchema = z.object({
  staffId: id,
  ...reviewNoteFields,
});
export type CreateReviewNoteInput = z.input<typeof createReviewNoteSchema>;

/**
 * Updates carry the full content; the action never changes a note's subject or
 * its author. `noteId` is the input `authorizeReviewNoteMutate` gates on — it
 * resolves the subject server-side rather than trusting the client for it.
 */
export const updateReviewNoteSchema = z.object({
  noteId: id,
  ...reviewNoteFields,
});
export type UpdateReviewNoteInput = z.input<typeof updateReviewNoteSchema>;

export const shareReviewNoteSchema = z.object({ noteId: id });
export type ShareReviewNoteInput = z.input<typeof shareReviewNoteSchema>;

export const deleteReviewNoteSchema = z.object({ noteId: id });
export type DeleteReviewNoteInput = z.input<typeof deleteReviewNoteSchema>;
