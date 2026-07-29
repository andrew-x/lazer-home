"use server";

import { authorizeReviewNoteCreate } from "@/actions/performance/reviewNoteAccess";
import { createReviewNoteSchema } from "@/actions/performance/reviewNotes.schema";
import { revalidateStaffProfile } from "@/actions/staff/staffProfileMutation";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { performanceReviewNote } from "@/lib/db/schema";

/**
 * Start a review note about a staff member. Always born a **draft** — only the
 * author (and an admin) can see it until `shareReviewNote` runs, so a manager can
 * write up a conversation before deciding to show it to the person.
 *
 * Authorization (admin, or the person's current manager) is enforced by the
 * `authorizeReviewNoteCreate` hook before this body runs.
 */
export const createReviewNote = secureActionClient
  .metadata({
    action: "create-review-note",
    authorize: authorizeReviewNoteCreate,
  })
  .inputSchema(createReviewNoteSchema)
  .action(async ({ parsedInput, ctx }) => {
    const [row] = await db
      .insert(performanceReviewNote)
      .values({
        id: generateId("prn"),
        staffId: parsedInput.staffId,
        authorUserId: ctx.user.id,
        noteDate: parsedInput.noteDate,
        title: parsedInput.title,
        body: parsedInput.body,
        status: "DRAFT",
      })
      .returning({ id: performanceReviewNote.id });

    revalidateStaffProfile(parsedInput.staffId);
    return { id: row.id };
  });
