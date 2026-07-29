"use server";

import { and, eq } from "drizzle-orm";
import { authorizeReviewNoteMutate } from "@/actions/performance/reviewNoteAccess";
import { shareReviewNoteSchema } from "@/actions/performance/reviewNotes.schema";
import { revalidateStaffProfile } from "@/actions/staff/staffProfileMutation";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { performanceReviewNote } from "@/lib/db/schema";

/**
 * Share a draft note with the person it's about — the one-way transition that
 * takes it out of the author's private view.
 *
 * There is deliberately **no un-share**: once shared, the person may have read
 * it, so flipping it back would only hide it from them while pretending it never
 * happened. Deleting the note is the escape hatch for a mistake.
 *
 * The `and(status = 'DRAFT')` in the where clause is the idempotency guard (same
 * shape as `compensationPlan.committedAt`): a second share matches no row and
 * errors instead of silently re-stamping `sharedAt`. Status is re-read from the
 * DB, never trusted from the client.
 *
 * Authorization is enforced by the `authorizeReviewNoteMutate` hook before this
 * body runs.
 */
export const shareReviewNote = secureActionClient
  .metadata({
    action: "share-review-note",
    authorize: authorizeReviewNoteMutate,
  })
  .inputSchema(shareReviewNoteSchema)
  .action(async ({ parsedInput }) => {
    const [row] = await db
      .update(performanceReviewNote)
      .set({ status: "SHARED", sharedAt: new Date() })
      .where(
        and(
          eq(performanceReviewNote.id, parsedInput.noteId),
          eq(performanceReviewNote.status, "DRAFT"),
        ),
      )
      .returning({ staffId: performanceReviewNote.staffId });

    if (!row) {
      throw new UserSafeActionError(
        "That note has already been shared, or no longer exists.",
      );
    }

    revalidateStaffProfile(row.staffId);
    return { ok: true };
  });
