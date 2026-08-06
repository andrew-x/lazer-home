import "server-only";

import { inArray } from "drizzle-orm";
import { logger } from "@/lib/core/logger";
import { db } from "@/lib/db/db";
import { opportunities, projects } from "@/lib/db/schema";
import {
  buildTranscriptViews,
  type TranscriptView,
} from "@/lib/home/transcripts";
import {
  DRIVE_NOT_CONFIGURED,
  DriveApiError,
  type DriveTranscript,
} from "./driveApi";
import {
  readAssignments,
  type TranscriptAssignmentRow,
} from "./transcriptFolders";

/**
 * The shared body of the two transcript reads (`getTranscriptTriage` and
 * `searchTranscripts`).
 *
 * Its own `server-only` module rather than living in either action, because a
 * `'use server'` file may only export **async** functions — a sync helper or a shared
 * type exported from one becomes a build error, and exporting a non-action async
 * function from one would silently publish it as a server action. Both actions import
 * from here and export nothing but themselves.
 */

/**
 * The result of loading a transcript list.
 *
 * A status envelope rather than a throw, following the rule `getSlackChannels` set and
 * `loadDriveFolderContents` follows: a read a surface renders must never throw, and
 * these failure states are *ordinary* rather than exceptional, each with a different
 * person who can fix it.
 *
 * `no-folders` is this feature's addition to that list, and it earns a case for
 * exactly ADR 0071 §10's reason. Collapsing it into an empty `ok` would render "no
 * transcripts in the last 7 days" at two very different people: someone who simply had
 * no meetings, and someone whose transcripts sit in a folder we don't look for — the
 * second of whom needs to be told which names we searched, or they conclude the
 * feature is broken and never find out it isn't.
 */
export type TranscriptTriage =
  | {
      status: "ok";
      transcripts: TranscriptView[];
      /** The folder names the listing covered, so the UI can say where it looked. */
      folderNames: string[];
      /**
       * True when Drive returned a full page, so this is part of the window rather
       * than all of it — the `truncated` honesty ADR 0071 §10 requires.
       */
      truncated: boolean;
    }
  | { status: "no-folders" }
  | { status: "reconnect" }
  | { status: "no-access" }
  | { status: "not-configured" }
  | { status: "unavailable" };

/**
 * Do the IO for a transcript listing and hand it to the pure fold.
 *
 * Both reads go through this one projector — they differ only in which Drive query
 * fed them, and a second projector would be a second chance to leak a field. The fold
 * itself lives in `@/lib/home/transcripts` so it can be tested as a disclosure
 * boundary, the way `buildOrgStatus` is.
 */
export async function loadTranscriptViews(
  userId: string,
  files: DriveTranscript[],
): Promise<TranscriptView[]> {
  const decisions = await readAssignments(
    userId,
    files.map((file) => file.id),
  );
  const recordNames = await readRecordNames(decisions);
  return buildTranscriptViews(files, decisions, recordNames);
}

/**
 * Current names for the records these assignments point at, in two indexed lookups
 * over a shortlist rather than a join per row.
 */
async function readRecordNames(
  assignments: TranscriptAssignmentRow[],
): Promise<Map<string, string>> {
  const opportunityIds = assignments
    .map((row) => row.opportunityId)
    .filter((value): value is string => value !== null);
  const projectIds = assignments
    .map((row) => row.projectId)
    .filter((value): value is string => value !== null);

  const [opportunityRows, projectRows] = await Promise.all([
    opportunityIds.length
      ? db
          .select({ id: opportunities.id, name: opportunities.name })
          .from(opportunities)
          .where(inArray(opportunities.id, opportunityIds))
      : Promise.resolve([]),
    projectIds.length
      ? db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : Promise.resolve([]),
  ]);

  const names = new Map<string, string>();
  for (const row of [...opportunityRows, ...projectRows]) {
    names.set(row.id, row.name);
  }
  return names;
}

/**
 * Map a failed read onto the envelope. Kept beside the envelope because the mapping is
 * the whole reason it has more than one failure case.
 */
export function transcriptReadFailure(error: unknown): TranscriptTriage {
  if (error instanceof DriveApiError) {
    if (error.code === DRIVE_NOT_CONFIGURED) {
      return { status: "not-configured" };
    }
    if (error.status === 401) return { status: "reconnect" };
    if (error.status === 403 || error.status === 404) {
      return { status: "no-access" };
    }
    logger.warn("drive_transcript_list_failed", {
      code: error.code,
      status: error.status,
    });
    return { status: "unavailable" };
  }
  // A timeout aborts rather than returning, so it lands here as a DOMException.
  logger.warn("drive_transcript_list_failed", { code: "unknown" });
  return { status: "unavailable" };
}
