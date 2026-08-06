"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { UserSafeActionError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import { transcriptAssignments } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/unique-violation";
import { buildDriveFolderName } from "@/lib/drive/folder";
import {
  googleDocUrl,
  TRANSCRIPTS_SUBFOLDER_NAME,
} from "@/lib/drive/transcript";
import { authorizeDriveFolder } from "./authorizeDriveFolder";
import { copyFailureError } from "./copyFailure";
import { createRecordFolder } from "./createRecordFolder";
import {
  DriveApiError,
  driveDelete,
  driveFileSchema,
  driveGetFile,
  drivePost,
  isDriveConfigured,
  resolveChildFolder,
} from "./driveApi";
import { DRIVE_FOLDER_TARGETS } from "./driveFolderLink";
import { requireDriveAccessToken } from "./driveToken";
import { assignTranscriptSchema } from "./transcript.schema";
import {
  resolveTranscriptFolders,
  TRANSCRIPT_TARGET_COLUMN,
} from "./transcriptFolders";

/**
 * What the caller must do next, when filing can't complete in one step.
 *
 * Not an error: a record with no Drive folder yet is the ordinary case the first
 * time anyone files anything against it, and the person needs to agree to creating
 * one rather than have it appear as a side effect.
 */
export type AssignTranscriptResult =
  | { status: "assigned"; copyUrl: string; folderCreated: boolean }
  | { status: "needs-folder"; recordName: string; folderName: string };

/**
 * File a transcript into `<record folder>/Transcripts`, creating the record's folder
 * first if the person confirms it.
 *
 * **Gated by `authorizeDriveFolder`**, so the capability follows the record being
 * written: `crm.edit` for an opportunity, `projects.edit` for a project. The two are
 * disjoint in the matrix, which is why this is an `authorize` hook rather than a
 * static `metadata.permission`, and why no new capability was added. A consequence
 * worth knowing: an ordinary `user` can see and dismiss their transcripts but cannot
 * file any of them — that is a deliberate decision recorded in ADR 0072, not an
 * oversight to route around.
 *
 * **The step order is the design**, mirroring `createRecordFolder` because the same
 * hazard applies — Drive is not transactional with our DB:
 *
 * 1. Read the record, so a missing one or a duplicate filing fails before anything
 *    external happens.
 * 2. Confirm the source really is one of this user's transcripts.
 * 3. No record folder yet → return `needs-folder` and touch nothing, unless the
 *    person has confirmed. With confirmation, create and link it.
 * 4. Find-or-create the `Transcripts` subfolder.
 * 5. Copy — the irreversible-ish step. The name comes from our own read of the
 *    source, never from the client.
 * 6. Record the filing. **If that write fails, delete the copy** — the compensation
 *    is exact, because the file is seconds old and we know its id.
 *
 * It **copies, never moves** (ADR 0071 §1's third leg): nothing here rewrites a
 * file's `parents`, so filing a transcript can't remove it from the person's own
 * Drive.
 */
export const assignTranscript = secureActionClient
  .metadata({
    action: "assign-transcript",
    authorize: authorizeDriveFolder,
  })
  .inputSchema(assignTranscriptSchema)
  .action(
    async ({
      parsedInput: { kind, recordId, fileId, confirmCreateFolder },
      ctx: { user },
    }) => {
      if (!isDriveConfigured()) {
        throw new UserSafeActionError("Google Drive isn't connected.");
      }

      const target = DRIVE_FOLDER_TARGETS[kind];
      const record = await target.read(recordId);
      if (!record) {
        throw new UserSafeActionError("That record no longer exists.");
      }

      await refuseDuplicate(user.id, fileId, kind, recordId, target.label);

      const accessToken = await requireDriveAccessToken(user.id);
      const source = await readTranscriptSource(user.id, fileId, accessToken);

      // Step 3. Returning rather than creating is what makes folder creation a
      // decision the person saw, and it is also the only branch a non-editor could
      // never reach — the gate above already refused them.
      let folderCreated = false;
      let recordFolderId = record.folderId;
      if (!recordFolderId) {
        const folderName = buildDriveFolderName(record.sourceName);
        if (!confirmCreateFolder) {
          return {
            status: "needs-folder",
            recordName: record.sourceName,
            folderName,
          } satisfies AssignTranscriptResult;
        }
        const created = await createRecordFolder(
          kind,
          recordId,
          folderName,
          accessToken,
        );
        recordFolderId = created.folderId;
        folderCreated = true;
      }

      let copiedFileId: string | null = null;
      try {
        // Inside the try so a failure here maps through `copyFailureError` like any
        // other Drive obstacle. Creating this subfolder can fail for exactly the
        // reasons a copy can (no write access to the shared drive, rate limit), and
        // outside the try it would escape as a raw `DriveApiError` and collapse to
        // the generic "something went wrong" — the least useful of the two.
        const transcriptsFolderId = await resolveChildFolder(
          TRANSCRIPTS_SUBFOLDER_NAME,
          recordFolderId,
          accessToken,
        );

        const copy = await drivePost(
          `/files/${encodeURIComponent(fileId)}/copy`,
          { fields: "id,name,mimeType,webViewLink" },
          { name: source.name, parents: [transcriptsFolderId] },
          accessToken,
          driveFileSchema,
        );
        copiedFileId = copy.id;

        await db.insert(transcriptAssignments).values({
          id: generateId("tra"),
          userId: user.id,
          driveFileId: fileId,
          fileName: source.name,
          fileCreatedAt: source.createdAt,
          dismissed: false,
          [TRANSCRIPT_TARGET_COLUMN[kind]]: recordId,
          copiedFileId: copy.id,
        });

        target.revalidate(recordId);
        revalidatePath("/");

        return {
          status: "assigned",
          copyUrl: googleDocUrl(copy.id),
          folderCreated,
        } satisfies AssignTranscriptResult;
      } catch (error) {
        // Step 6's compensation. The copy exists but nothing records it, so leaving
        // it would put an untracked duplicate in a client folder that the widget
        // would then offer to file again.
        if (copiedFileId) {
          await deleteQuietly(copiedFileId, accessToken, fileId);
        }
        if (error instanceof UserSafeActionError) throw error;
        if (
          isUniqueViolation(error, "transcript_assignments_project_idx") ||
          isUniqueViolation(error, "transcript_assignments_opportunity_idx")
        ) {
          throw new UserSafeActionError(
            `That transcript is already filed to this ${target.label.replace(" folder", "").toLowerCase()}.`,
          );
        }
        throw copyFailureError(error);
      }
    },
  );

/**
 * Refuse a second filing of the same transcript against the same record.
 *
 * The unique indexes are the real defence — this is the readable error, checked
 * before the Drive work so the common case doesn't create a copy just to delete it.
 */
async function refuseDuplicate(
  userId: string,
  fileId: string,
  kind: keyof typeof TRANSCRIPT_TARGET_COLUMN,
  recordId: string,
  label: string,
): Promise<void> {
  const column = TRANSCRIPT_TARGET_COLUMN[kind];
  const existing = await db
    .select({ id: transcriptAssignments.id })
    .from(transcriptAssignments)
    .where(
      and(
        eq(transcriptAssignments.userId, userId),
        eq(transcriptAssignments.driveFileId, fileId),
        eq(transcriptAssignments[column], recordId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    throw new UserSafeActionError(
      `That transcript is already filed to this ${label.replace(" folder", "").toLowerCase()}.`,
    );
  }
}

/**
 * Read the source doc and confirm it is one of this user's transcripts.
 *
 * Not a security boundary — `copyDriveFile` already copies any file the caller can
 * read into any shared folder they can write to, so this refuses nothing they
 * couldn't otherwise do. It is a *correctness* boundary: it keeps a row in
 * `transcript_assignments` meaning what it says, and it stops a stale widget from
 * filing a document that has since been moved out of a transcript folder.
 */
async function readTranscriptSource(
  userId: string,
  fileId: string,
  accessToken: string,
): Promise<{ name: string; createdAt: Date | null }> {
  const folders = await resolveTranscriptFolders(userId, accessToken);
  const allowed = new Set(folders.map((folder) => folder.driveFolderId));
  if (allowed.size === 0) {
    throw new UserSafeActionError(
      "We can't find any transcript folders in your Drive.",
    );
  }

  let file: Awaited<ReturnType<typeof driveGetFile>>;
  try {
    file = await driveGetFile(fileId, accessToken);
  } catch (error) {
    if (error instanceof DriveApiError && error.status === 401) {
      throw new UserSafeActionError(
        "Reconnect your Google account to use Drive.",
      );
    }
    throw new UserSafeActionError(
      "We can't read that transcript — you may no longer have access to it.",
    );
  }

  if (!(file.parents ?? []).some((parent) => allowed.has(parent))) {
    throw new UserSafeActionError(
      "That file isn't in one of your transcript folders any more. Refresh the list and try again.",
    );
  }

  return {
    name: file.name,
    createdAt: file.createdTime ? new Date(file.createdTime) : null,
  };
}

/**
 * Undo a copy whose record then failed to write. Best effort by necessity: if this
 * also fails there is nothing further to try, so log loudly enough that someone can
 * find and remove the stray file by hand.
 */
async function deleteQuietly(
  copiedFileId: string,
  accessToken: string,
  sourceFileId: string,
): Promise<void> {
  try {
    await driveDelete(copiedFileId, accessToken);
  } catch (error) {
    logger.error("transcript_copy_orphaned", {
      copiedFileId,
      sourceFileId,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}
