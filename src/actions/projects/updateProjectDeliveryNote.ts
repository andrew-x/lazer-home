"use server";

import { eq } from "drizzle-orm";
import { updateProjectDeliveryNoteSchema } from "@/actions/projects/deliveryNotes.schema";
import { revalidateProject } from "@/actions/projects/revalidate";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { projectDeliveryNotes } from "@/lib/db/schema";

/**
 * Correct an existing delivery note. Gated on the same static `projects.edit`
 * capability as creating one, deliberately **not** author-only: a delivery note is
 * the operational record of a shared engagement, so the team that runs it can fix
 * it. (Contrast a self-evaluation, which is author-only with no admin override —
 * ADR 0058 — because there the author is the whole point. See ADR 0059.)
 *
 * Two columns are never touched. `authorStaffId` stays put: because the gate isn't
 * author-only, an editor is usually *not* the writer, and the note should keep
 * saying who wrote it. `projectId` stays put because a note belongs to the
 * engagement it was written about.
 *
 * `.returning()` guards against the note being deleted mid-edit and yields the
 * project id for revalidation.
 */
export const updateProjectDeliveryNote = secureActionClient
  .metadata({
    action: "update-project-delivery-note",
    permission: { projects: ["edit"] },
  })
  .inputSchema(updateProjectDeliveryNoteSchema)
  .action(async ({ parsedInput }) => {
    const rows = await db
      .update(projectDeliveryNotes)
      .set({
        noteDate: parsedInput.noteDate,
        title: parsedInput.title,
        body: parsedInput.body,
        projectHealth: parsedInput.projectHealth,
      })
      .where(eq(projectDeliveryNotes.id, parsedInput.noteId))
      .returning({ projectId: projectDeliveryNotes.projectId });
    assertRowExists(rows, "delivery note");

    revalidateProject(rows[0].projectId);
    return { id: parsedInput.noteId };
  });
