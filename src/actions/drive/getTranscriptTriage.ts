"use server";

import { secureActionClient } from "@/lib/core/action";
import { transcriptWindowStart } from "@/lib/drive/transcript";
import {
  DRIVE_LIST_PAGE_SIZE,
  driveListTranscriptDocs,
  isDriveConfigured,
} from "./driveApi";
import { getDriveAccessToken } from "./driveToken";
import { triageWindowSchema } from "./transcript.schema";
import { resolveTranscriptFolders } from "./transcriptFolders";
import {
  loadTranscriptViews,
  type TranscriptTriage,
  transcriptReadFailure,
} from "./transcriptTriage";

/**
 * The transcripts in this user's own Drive from the last `days` days, with any triage
 * decisions already made against them.
 *
 * A `'use server'` action rather than a `server-only get*`, under the interactive-read
 * exception — and that choice is load-bearing rather than stylistic. ADR 0071 §11 kept
 * both existing Drive surfaces free of a round-trip on their render path, and the home
 * dashboard is the worst place in the app to spend two uncacheable per-user Drive
 * calls: every signed-in person loads it, and Drive reads cannot be cached at all
 * (§4). So the widget loads its own contents on mount and `/` renders without waiting
 * for Google.
 *
 * **Carries no capability, deliberately.** It reads the caller's own Drive on the
 * caller's own token and their own triage rows, and the listing is bounded to the
 * folders stored for that caller. There is nothing a gate could add, and the reasoning
 * ADR 0071 §7 gives for browse/copy/search applies verbatim.
 */
export const getTranscriptTriage = secureActionClient
  .metadata({ action: "get-transcript-triage" })
  .inputSchema(triageWindowSchema)
  .action(async ({ parsedInput: { days }, ctx: { user } }) => {
    if (!isDriveConfigured()) {
      return { status: "not-configured" } satisfies TranscriptTriage;
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

      const files = await driveListTranscriptDocs(
        folders.map((folder) => folder.driveFolderId),
        transcriptWindowStart(Date.now(), days),
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
