"use server";

import { and, desc, eq } from "drizzle-orm";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { transcriptAssignments } from "@/lib/db/schema";
import { emptyInputSchema } from "./transcript.schema";

/**
 * One transcript this user dismissed.
 *
 * Read from **our** snapshot rather than from Drive, deliberately: a dismissal is
 * often the last thing that ever happens to a transcript, and re-reading Drive to
 * render the archive would mean an internal standup nobody will ever file still
 * costs a Drive call every time someone opens this dialog. It also means the archive
 * still lists a transcript whose source has since been renamed or deleted, which is
 * exactly when someone goes looking for it.
 *
 * The cost of that choice, stated: `fileName` is the name as it was when dismissed,
 * so a later rename in Drive is not reflected here. Same trade as the folder-name
 * snapshot in ADR 0071 §9.
 */
export type DismissedTranscriptView = {
  fileId: string;
  name: string;
  dismissedAt: number;
};

/**
 * This user's dismissed transcripts, most recently dismissed first.
 *
 * **Own-data-only by construction**, which is why it carries no capability: the query
 * is filtered on `ctx.user.id` and there is no id from the client to authorize. The
 * `getMyTasks` shape.
 *
 * Unbounded rather than capped: a dismissal row is tiny, one per transcript per
 * person, and the alternative — a limit — would need a `truncated` flag and copy to
 * explain it for a list that realistically runs to a few hundred rows.
 */
export const getDismissedTranscripts = secureActionClient
  .metadata({ action: "get-dismissed-transcripts" })
  .inputSchema(emptyInputSchema)
  .action(async ({ ctx: { user } }) => {
    const rows = await db
      .select({
        fileId: transcriptAssignments.driveFileId,
        name: transcriptAssignments.fileName,
        createdAt: transcriptAssignments.createdAt,
      })
      .from(transcriptAssignments)
      .where(
        and(
          eq(transcriptAssignments.userId, user.id),
          eq(transcriptAssignments.dismissed, true),
        ),
      )
      .orderBy(desc(transcriptAssignments.createdAt));

    // Copies field by field — never spread. See {@link DismissedTranscriptView}.
    return rows.map(
      (row): DismissedTranscriptView => ({
        fileId: row.fileId,
        name: row.name,
        dismissedAt: row.createdAt.getTime(),
      }),
    );
  });
