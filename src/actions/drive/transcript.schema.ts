import { z } from "zod";
import { searchQuerySchema } from "@/lib/core/search";
import { TRIAGE_WINDOW_DAYS } from "@/lib/drive/transcript";
import { id } from "@/lib/schemas/id-schema";
import { driveFolderKindSchema, driveResourceId } from "./driveFolder.schema";

/**
 * Input schemas for the transcript-triage actions.
 *
 * A pure, client-importable module (no `db`, no drizzle): the Triage panel, its
 * rows and the assign dialog all import these, so a Drizzle table here would drag
 * the whole ORM into the client bundle (ADR 0035).
 */

/**
 * No input at all, for the archive read.
 *
 * `next-safe-action` requires an input schema, and an empty object is the honest one
 * here: the subject is `ctx.user`, so there is nothing for a client to supply. The
 * same shape `getDrivePickerToken` uses, and for the same reason — a `userId`
 * parameter on an own-data read is how it stops being an own-data read.
 */
export const emptyInputSchema = z.object({});

/**
 * How far back the triage list reaches, in days.
 *
 * Constrained to the `TRIAGE_WINDOW_DAYS` ladder rather than accepting any number:
 * the window becomes a Drive query, and an unbounded value is an invitation to ask
 * for ten years of a personal Drive in one call. The ladder is also what the
 * "show more" button walks, so accepting anything else would let the client and the
 * UI disagree about which windows exist.
 */
export const triageWindowSchema = z.object({
  days: z
    .number()
    .int()
    .refine(
      (value): value is (typeof TRIAGE_WINDOW_DAYS)[number] =>
        (TRIAGE_WINDOW_DAYS as readonly number[]).includes(value),
      `Pick one of the ${TRIAGE_WINDOW_DAYS.join(", ")} day windows`,
    )
    .default(TRIAGE_WINDOW_DAYS[0]),
});

/**
 * Search this user's transcripts by file name, across all time.
 *
 * No window, deliberately: the point of searching by name is to find a meeting
 * older than the list currently shows. What bounds it is not a date but the stored
 * folder set — the search can only ever reach inside the same folders the list
 * does.
 */
export const searchTranscriptsSchema = searchQuerySchema;

/**
 * File a transcript into a record's `/Transcripts` folder.
 *
 * `kind` is required and comes first in spirit even though the field order doesn't
 * matter: `authorizeDriveFolder` parses it off the **raw** `clientInput` before this
 * schema runs, and resolves `crm.edit` vs `projects.edit` from it. An unparseable
 * kind is denied rather than skipped.
 *
 * `confirmCreateFolder` is the second half of a two-step flow, not a convenience
 * flag. Without it, a record that has no Drive folder yet returns `needs-folder`
 * and nothing external happens — so creating a folder is always something the
 * person saw and agreed to, never a side effect of filing a file.
 */
export const assignTranscriptSchema = z.object({
  kind: driveFolderKindSchema,
  recordId: id,
  fileId: driveResourceId,
  confirmCreateFolder: z.boolean().default(false),
});

/**
 * Dismiss a transcript as not worth filing, or restore it.
 *
 * Takes no target and no user id: the row is keyed on `ctx.user.id`, so this is
 * own-data-only by construction and there is no ownership check to get wrong.
 */
export const dismissTranscriptSchema = z.object({
  fileId: driveResourceId,
  /** The name to snapshot on a new dismissal row. Ignored when restoring. */
  fileName: z.string().trim().min(1).max(512),
  dismissed: z.boolean(),
});

/**
 * Type-ahead over the records a transcript can be filed to.
 *
 * `kind` selects which table is searched. It is **nullish** so the action still
 * satisfies the generic `SearchAction` contract that `EntityCombobox` requires
 * (an input reducible to `{ query }`) — the same accommodation `searchProjects`
 * makes for its `companyId`. The dialog always supplies it via `searchArgs`, and a
 * missing kind returns nothing rather than guessing a table.
 *
 * Note this action is **deliberately ungated** — see the note on the action itself,
 * and the entry in docs/domains/permissions.md.
 */
export const searchTranscriptTargetsSchema = searchQuerySchema.extend({
  kind: driveFolderKindSchema.nullish(),
});

export type TriageWindowInput = z.infer<typeof triageWindowSchema>;
export type SearchTranscriptsInput = z.infer<typeof searchTranscriptsSchema>;
export type AssignTranscriptInput = z.infer<typeof assignTranscriptSchema>;
export type DismissTranscriptInput = z.infer<typeof dismissTranscriptSchema>;
export type SearchTranscriptTargetsInput = z.infer<
  typeof searchTranscriptTargetsSchema
>;
