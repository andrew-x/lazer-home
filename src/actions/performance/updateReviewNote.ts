"use server";

import { eq } from "drizzle-orm";
import { authorizeReviewNoteMutate } from "@/actions/performance/reviewNoteAccess";
import { updateReviewNoteSchema } from "@/actions/performance/reviewNotes.schema";
import { revalidateStaffProfile } from "@/actions/staff/staffProfileMutation";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { performanceReviewNote } from "@/lib/db/schema";

/**
 * Edit a review note's content. Allowed in **both** states: a shared note can
 * still be corrected (the panel marks an edited note, so the person can see it
 * changed). `status`, `staffId` and `authorUserId` are never touched here —
 * sharing is its own action, and a note can't be moved to another person.
 *
 * Authorization (author, admin, or the person's current manager) is enforced by
 * the `authorizeReviewNoteMutate` hook before this body runs.
 */
export const updateReviewNote = secureActionClient
  .metadata({
    action: "update-review-note",
    authorize: authorizeReviewNoteMutate,
  })
  .inputSchema(updateReviewNoteSchema)
  .action(async ({ parsedInput }) => {
    const [row] = await db
      .update(performanceReviewNote)
      .set({
        noteDate: parsedInput.noteDate,
        title: parsedInput.title,
        body: parsedInput.body,
      })
      .where(eq(performanceReviewNote.id, parsedInput.noteId))
      .returning({ staffId: performanceReviewNote.staffId });

    if (!row) throw new UserSafeActionError("That note no longer exists.");

    revalidateStaffProfile(row.staffId);
    return { ok: true };
  });
