"use server";

import { revalidatePath } from "next/cache";
import { secureActionClient } from "@/lib/core/action";
import { isDriveConfigured } from "./driveApi";
import { getDriveAccessToken } from "./driveToken";
import { emptyInputSchema } from "./transcript.schema";
import { rediscoverTranscriptFolders } from "./transcriptFolders";
import {
  type TranscriptTriage,
  transcriptReadFailure,
} from "./transcriptTriage";

/**
 * Look again for transcript folders in this user's Drive.
 *
 * **This exists because automatic discovery only fires when nothing is stored.**
 * `resolveTranscriptFolders` runs its search on the first load and then never again,
 * deliberately — re-searching a personal Drive on every dashboard load would be a
 * standing cost for an answer that changes about once per person. The consequence is
 * that a folder created *after* that first load is invisible: someone whose Drive had
 * `Meet Recordings` and who later installs Tactiq would never see the new folder's
 * transcripts, with nothing on screen to explain why.
 *
 * Rediscovery is **additive** — it inserts what it finds and removes nothing, so a
 * rescan can only ever widen what you see, never silently drop a folder you were
 * already reading from.
 *
 * **Own-data-only by construction**, hence no capability: it takes no input, searches
 * the caller's own Drive on the caller's own token, and writes rows keyed on
 * `ctx.user.id`. The same shape as `getDrivePickerToken`'s empty schema, and for the
 * same reason — a `userId` parameter here would make it a search of someone else's
 * Drive.
 */
export const rescanTranscriptFolders = secureActionClient
  .metadata({ action: "rescan-transcript-folders" })
  .inputSchema(emptyInputSchema)
  .action(async ({ ctx: { user } }) => {
    if (!isDriveConfigured()) {
      return { status: "not-configured" } satisfies TranscriptTriage;
    }

    const accessToken = await getDriveAccessToken(user.id);
    if (!accessToken) {
      return { status: "reconnect" } satisfies TranscriptTriage;
    }

    try {
      const folders = await rediscoverTranscriptFolders(user.id, accessToken);
      if (folders.length === 0) {
        return { status: "no-folders" } satisfies TranscriptTriage;
      }

      // The caller reloads its own listing rather than getting one back: this action
      // decides *where* to read, not *what* was found, and returning a list here
      // would be a second projector of the same payload.
      revalidatePath("/");
      return {
        status: "ok",
        transcripts: [],
        folderNames: folders.map((folder) => folder.folderName),
        truncated: false,
      } satisfies TranscriptTriage;
    } catch (error) {
      return transcriptReadFailure(error);
    }
  });
