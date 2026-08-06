"use server";

import { secureActionClient } from "@/lib/core/action";
import {
  DRIVE_LIST_PAGE_SIZE,
  driveSearchTranscriptDocs,
  isDriveConfigured,
} from "./driveApi";
import { getDriveAccessToken } from "./driveToken";
import { searchTranscriptsSchema } from "./transcript.schema";
import { resolveTranscriptFolders } from "./transcriptFolders";
import {
  loadTranscriptViews,
  type TranscriptTriage,
  transcriptReadFailure,
} from "./transcriptTriage";

/**
 * Search this user's transcripts by file name, **across all time**.
 *
 * Deliberately not a client-side filter over the loaded window, which is how the
 * home dashboard's task list searches. The difference is where the data lives: the
 * tasks are already in the payload, whereas transcripts live in Drive and the panel
 * only ever holds one window of them. Filtering that window would mean a search for
 * a meeting from two months ago quietly returned nothing — the worst possible answer,
 * because it looks identical to "that transcript doesn't exist".
 *
 * Returns the same envelope and the same `TranscriptView` shape as
 * `getTranscriptTriage`, through the same projector, so the panel renders results
 * with one code path and there is no second place a field could leak.
 *
 * **Carries no capability**, for the same reason as the triage read: the caller's own
 * Drive on the caller's own token, bounded to the caller's own stored folders.
 */
export const searchTranscripts = secureActionClient
  .metadata({ action: "search-transcripts" })
  .inputSchema(searchTranscriptsSchema)
  .action(async ({ parsedInput: { query }, ctx: { user } }) => {
    if (!isDriveConfigured()) {
      return { status: "not-configured" } satisfies TranscriptTriage;
    }
    if (query === "") {
      return {
        status: "ok",
        transcripts: [],
        folderNames: [],
        truncated: false,
      } satisfies TranscriptTriage;
    }

    const accessToken = await getDriveAccessToken(user.id);
    if (!accessToken) {
      return { status: "reconnect" } satisfies TranscriptTriage;
    }

    try {
      const folders = await resolveTranscriptFolders(user.id, accessToken);
      if (folders.length === 0) {
        return { status: "no-folders" } satisfies TranscriptTriage;
      }

      const files = await driveSearchTranscriptDocs(
        folders.map((folder) => folder.driveFolderId),
        query,
        accessToken,
      );

      return {
        status: "ok",
        transcripts: await loadTranscriptViews(user.id, files),
        folderNames: folders.map((folder) => folder.folderName),
        truncated: files.length >= DRIVE_LIST_PAGE_SIZE,
      } satisfies TranscriptTriage;
    } catch (error) {
      return transcriptReadFailure(error);
    }
  });
