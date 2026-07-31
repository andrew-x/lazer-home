import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { projectDeliveryNotes, staff } from "@/lib/db/schema";

/** One delivery note, shaped for the panel that renders the log. */
export type ProjectDeliveryNoteRow = {
  id: string;
  /** The date the note is about ("YYYY-MM-DD"), not when it was typed. */
  noteDate: string;
  title: string | null;
  body: string;
  projectHealth: number;
  /** Display name of whoever wrote it; null when their staff row is gone. */
  authorName: string | null;
  /** Their staff id, so the panel can link the name — null alongside the name. */
  authorStaffId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * "Latest note first": the author-chosen date, then `createdAt` breaking a tie
 * between two notes dated the same day.
 *
 * Exported and shared with `getProjectsList`'s `distinct on (project_id)` so the
 * list's health metric and the top of this log can never disagree about which note
 * is current — one ordering rule, two readers. The table's index is declared in
 * exactly this direction.
 */
export const latestDeliveryNoteFirst = [
  desc(projectDeliveryNotes.noteDate),
  desc(projectDeliveryNotes.createdAt),
];

/**
 * Every delivery note on a project, newest first. Reads are open — like every
 * other project read — so this takes no user and applies no mask.
 *
 * Returns a bare array rather than a `…View` object with a `canCreate` flag: who
 * may write is the static `projects.edit` capability the page already computes as
 * `canEdit`, so carrying it here too would be a second source for one boolean.
 * (`getStaffReviewNotes` does return a view object, because there what a given
 * reader may see genuinely varies per row.)
 */
export async function getProjectDeliveryNotes(
  projectId: string,
): Promise<ProjectDeliveryNoteRow[]> {
  return (
    db
      .select({
        id: projectDeliveryNotes.id,
        noteDate: projectDeliveryNotes.noteDate,
        title: projectDeliveryNotes.title,
        body: projectDeliveryNotes.body,
        projectHealth: projectDeliveryNotes.projectHealth,
        authorName: staff.name,
        authorStaffId: staff.id,
        createdAt: projectDeliveryNotes.createdAt,
        updatedAt: projectDeliveryNotes.updatedAt,
      })
      .from(projectDeliveryNotes)
      // LEFT join, not inner: `authorStaffId` is nullable — set null when the
      // author's staff row is deleted, and null when the writer has none — and an
      // inner join would silently drop those notes from the log.
      .leftJoin(staff, eq(projectDeliveryNotes.authorStaffId, staff.id))
      .where(eq(projectDeliveryNotes.projectId, projectId))
      .orderBy(...latestDeliveryNoteFirst)
  );
}
