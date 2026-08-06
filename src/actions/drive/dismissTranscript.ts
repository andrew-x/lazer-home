"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { transcriptAssignments } from "@/lib/db/schema";
import { dismissTranscriptSchema } from "./transcript.schema";

/**
 * Mark a transcript as not worth filing, or restore one that was.
 *
 * The triage list needs this to be usable at all: most recordings are internal
 * standups and one-to-ones that belong to no client record, and without a way to
 * clear them they accumulate in the widget until nobody reads it.
 *
 * **Own-data-only by construction, which is why it carries no capability.** The row
 * is keyed on `ctx.user.id` — never on a user id from the client — so both the write
 * and the delete can only ever reach this caller's own decisions. There is no target
 * id to authorize and no ownership check to get wrong, the same shape `getMyTasks`
 * relies on. Note a dismissal touches **nothing in Drive**: the transcript stays
 * exactly where it is, which is what makes it safely reversible.
 *
 * Dismissing is idempotent (`onConflictDoNothing` against the partial unique index),
 * so a double-click is a no-op rather than a constraint error.
 */
export const dismissTranscript = secureActionClient
  .metadata({ action: "dismiss-transcript" })
  .inputSchema(dismissTranscriptSchema)
  .action(
    async ({ parsedInput: { fileId, fileName, dismissed }, ctx: { user } }) => {
      if (dismissed) {
        await db
          .insert(transcriptAssignments)
          .values({
            id: generateId("tra"),
            userId: user.id,
            driveFileId: fileId,
            fileName,
            dismissed: true,
          })
          .onConflictDoNothing();
      } else {
        // Delete only the dismissal row. The `dismissed` predicate is what keeps
        // this from also removing this file's assignment rows, which are separate
        // decisions the person hasn't undone.
        await db
          .delete(transcriptAssignments)
          .where(
            and(
              eq(transcriptAssignments.userId, user.id),
              eq(transcriptAssignments.driveFileId, fileId),
              eq(transcriptAssignments.dismissed, true),
            ),
          );
      }

      revalidatePath("/");
      return { fileId, dismissed };
    },
  );
