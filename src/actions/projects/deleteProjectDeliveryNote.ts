"use server";

import { eq } from "drizzle-orm";
import { deleteProjectDeliveryNoteSchema } from "@/actions/projects/deliveryNotes.schema";
import { revalidateProject } from "@/actions/projects/revalidate";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { secureActionClient } from "@/lib/core/action";
import { db } from "@/lib/db/db";
import { projectDeliveryNotes } from "@/lib/db/schema";

/**
 * Delete a delivery note. Same static `projects.edit` gate as writing one — not
 * author-only (see `updateProjectDeliveryNote`).
 *
 * Deleting the newest note is how a project's list-level health falls back to the
 * one before it, or to "Not rated" when it was the only one. `.returning()`
 * confirms the row existed and yields the project id for revalidation.
 */
export const deleteProjectDeliveryNote = secureActionClient
  .metadata({
    action: "delete-project-delivery-note",
    permission: { projects: ["edit"] },
  })
  .inputSchema(deleteProjectDeliveryNoteSchema)
  .action(async ({ parsedInput }) => {
    const rows = await db
      .delete(projectDeliveryNotes)
      .where(eq(projectDeliveryNotes.id, parsedInput.noteId))
      .returning({ projectId: projectDeliveryNotes.projectId });
    assertRowExists(rows, "delivery note");

    revalidateProject(rows[0].projectId);
    return { id: parsedInput.noteId };
  });
