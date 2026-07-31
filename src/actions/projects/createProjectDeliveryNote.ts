"use server";

import { createProjectDeliveryNoteSchema } from "@/actions/projects/deliveryNotes.schema";
import { revalidateProject } from "@/actions/projects/revalidate";
import { resolveAuthorStaffId } from "@/actions/shared/resolveAuthorStaffId";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { isForeignKeyViolation } from "@/lib/db/foreign-key-violation";
import { generateId } from "@/lib/db/ids";
import { projectDeliveryNotes } from "@/lib/db/schema";

/**
 * Record a delivery note on a project — a dated read on how the engagement is
 * going, carrying the author's 1–10 health rating.
 *
 * Gated on the static `projects.edit` capability (delivery managers, managers and
 * admins), the same gate every other project write declares. There is no draft
 * state and no per-row check: a note is visible to everyone who can see the
 * project the moment it is written, which the form says out loud.
 *
 * The author is resolved from the session, never accepted from the client, and is
 * attribution only — `updateProjectDeliveryNote` does not consult it.
 */
export const createProjectDeliveryNote = secureActionClient
  .metadata({
    action: "create-project-delivery-note",
    permission: { projects: ["edit"] },
  })
  .inputSchema(createProjectDeliveryNoteSchema)
  .action(async ({ parsedInput, ctx }) => {
    const authorStaffId = await resolveAuthorStaffId(ctx.user);
    const noteId = generateId("pdn");

    try {
      await db.insert(projectDeliveryNotes).values({
        id: noteId,
        projectId: parsedInput.projectId,
        authorStaffId,
        noteDate: parsedInput.noteDate,
        title: parsedInput.title,
        body: parsedInput.body,
        projectHealth: parsedInput.projectHealth,
      });
    } catch (error) {
      // The FK is the guard against a stale project id, so there's no pre-read to
      // race with — same as `addEntry`.
      if (isForeignKeyViolation(error)) {
        throw new UserSafeActionError("That project no longer exists.");
      }
      throw error;
    }

    revalidateProject(parsedInput.projectId);
    return { id: noteId };
  });
