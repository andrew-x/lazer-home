"use server";

import { eq } from "drizzle-orm";
import { authorizeReviewNoteMutate } from "@/actions/performance/reviewNoteAccess";
import { deleteReviewNoteSchema } from "@/actions/performance/reviewNotes.schema";
import { revalidateStaffProfile } from "@/actions/staff/staffProfileMutation";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { performanceReviewNote } from "@/lib/db/schema";

/**
 * Delete a review note. Works in both states on purpose: since sharing is
 * one-way, deletion is the only way to retract a note shared by mistake.
 *
 * Authorization (author, admin, or the person's current manager) is enforced by
 * the `authorizeReviewNoteMutate` hook before this body runs.
 */
export const deleteReviewNote = secureActionClient
  .metadata({
    action: "delete-review-note",
    authorize: authorizeReviewNoteMutate,
  })
  .inputSchema(deleteReviewNoteSchema)
  .action(async ({ parsedInput }) => {
    const [row] = await db
      .delete(performanceReviewNote)
      .where(eq(performanceReviewNote.id, parsedInput.noteId))
      .returning({ staffId: performanceReviewNote.staffId });

    if (!row) throw new UserSafeActionError("That note no longer exists.");

    revalidateStaffProfile(row.staffId);
    return { ok: true };
  });
