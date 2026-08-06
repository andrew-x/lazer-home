import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { driveTranscriptFolders, transcriptAssignments } from "@/lib/db/schema";
import type { DriveFolderKind } from "@/lib/drive/folder";
import { driveFindTranscriptFolders } from "./driveApi";

/**
 * The stored transcript folders for one user, discovering them on first use.
 *
 * **This function is the read boundary for the whole feature.** Every personal-Drive
 * listing takes its parent ids from here, so the folder ids it returns are exactly
 * the set of places we can see into. Two consequences worth holding:
 *
 * - It returns `[]` rather than throwing when a user has no transcript folders, and
 *   every caller must treat `[]` as "look nowhere" — `transcriptDocsQuery` returns
 *   `null` for an empty list specifically so that can't silently become "look
 *   everywhere".
 * - Discovery is **silent**, by decision (see ADR 0072): the first widget load
 *   searches the user's own Drive for the five names in `TRANSCRIPT_FOLDER_NAMES`
 *   without asking. That is the one place this feature reads a Drive the user hasn't
 *   pointed us at, and it is why the widget names the folders it looked in.
 *
 * Discovery re-runs whenever nothing is stored, which also covers the case where a
 * user creates their first Tactiq folder after signing up. It does **not** re-run
 * once anything is stored, so an ordinary page load never re-searches a Drive it has
 * already looked at — a *later* folder is picked up only by the explicit rescan
 * (`rediscoverTranscriptFolders`, reached from the widget's "Check for new folders"
 * control via `rescanTranscriptFolders`). That asymmetry is the deliberate trade:
 * re-searching every load would be a standing cost on a personal Drive for an answer
 * that changes about once per person, but it does mean the rescan is the **only**
 * thing standing between a new folder and permanent invisibility. Don't remove it
 * without replacing it.
 */
export async function resolveTranscriptFolders(
  userId: string,
  accessToken: string,
): Promise<Array<{ driveFolderId: string; folderName: string }>> {
  const stored = await readStoredFolders(userId);
  if (stored.length > 0) return stored;

  const found = await driveFindTranscriptFolders(accessToken);
  if (found.length === 0) return [];

  await db
    .insert(driveTranscriptFolders)
    .values(
      found.map((folder) => ({
        id: generateId("dtf"),
        userId,
        driveFolderId: folder.id,
        folderName: folder.name,
      })),
    )
    // Two tabs opening the dashboard at once both discover and both insert. The
    // unique index on (userId, driveFolderId) makes that converge instead of
    // duplicating every folder.
    .onConflictDoNothing();

  // Re-read rather than returning `found`, so the caller always sees what is
  // actually stored — the row set is the boundary, not the API response.
  return readStoredFolders(userId);
}

/**
 * Re-run discovery for a user who has added a folder since they first loaded the
 * widget. Additive: existing rows are kept, so nothing that was already being read
 * stops being read.
 */
export async function rediscoverTranscriptFolders(
  userId: string,
  accessToken: string,
): Promise<Array<{ driveFolderId: string; folderName: string }>> {
  const found = await driveFindTranscriptFolders(accessToken);
  if (found.length > 0) {
    await db
      .insert(driveTranscriptFolders)
      .values(
        found.map((folder) => ({
          id: generateId("dtf"),
          userId,
          driveFolderId: folder.id,
          folderName: folder.name,
        })),
      )
      .onConflictDoNothing();
  }
  return readStoredFolders(userId);
}

function readStoredFolders(
  userId: string,
): Promise<Array<{ driveFolderId: string; folderName: string }>> {
  return db
    .select({
      driveFolderId: driveTranscriptFolders.driveFolderId,
      folderName: driveTranscriptFolders.folderName,
    })
    .from(driveTranscriptFolders)
    .where(eq(driveTranscriptFolders.userId, userId));
}

/** One filing of a transcript, as stored. */
export type TranscriptAssignmentRow = {
  driveFileId: string;
  dismissed: boolean;
  opportunityId: string | null;
  projectId: string | null;
  copiedFileId: string | null;
};

/**
 * This user's triage decisions for the given source file ids.
 *
 * Takes the specific ids Drive just returned — a shortlist — rather than reading
 * every row for the user, so this stays one indexed lookup however long someone has
 * been using the feature. Same reasoning as `folderIdsAlreadyLinked`.
 */
export async function readAssignments(
  userId: string,
  driveFileIds: string[],
): Promise<TranscriptAssignmentRow[]> {
  if (driveFileIds.length === 0) return [];

  return db
    .select({
      driveFileId: transcriptAssignments.driveFileId,
      dismissed: transcriptAssignments.dismissed,
      opportunityId: transcriptAssignments.opportunityId,
      projectId: transcriptAssignments.projectId,
      copiedFileId: transcriptAssignments.copiedFileId,
    })
    .from(transcriptAssignments)
    .where(
      and(
        eq(transcriptAssignments.userId, userId),
        inArray(transcriptAssignments.driveFileId, driveFileIds),
      ),
    );
}

/**
 * Which column on `transcript_assignments` holds each record kind's target.
 *
 * Keyed on `DriveFolderKind` so it cannot drift from `DRIVE_FOLDER_TARGETS` — the
 * gate resolves a capability from the same kind, and a mismatch here would mean
 * writing a `projectId` on a row the gate authorized as an opportunity.
 */
export const TRANSCRIPT_TARGET_COLUMN: Record<
  DriveFolderKind,
  "opportunityId" | "projectId"
> = {
  sales: "opportunityId",
  project: "projectId",
};
