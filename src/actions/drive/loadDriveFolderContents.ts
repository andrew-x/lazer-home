"use server";

import { secureActionClient } from "@/lib/core/action";
import { logger } from "@/lib/core/logger";
import { driveQuoteValue, isDriveFolder } from "@/lib/drive/folder";
import {
  DRIVE_LIST_PAGE_SIZE,
  DRIVE_NOT_CONFIGURED,
  DriveApiError,
  driveList,
  isDriveConfigured,
} from "./driveApi";
import { listDriveFolderSchema } from "./driveFolder.schema";
import { getDriveAccessToken } from "./driveToken";

/**
 * One entry in a folder listing, projected down from Drive's file resource — we
 * store nothing, so this shape exists only to be rendered.
 */
export type DriveEntry = {
  id: string;
  name: string;
  isFolder: boolean;
  /** Drive's own link. Never constructed by us — files have several URL shapes. */
  webViewLink: string | null;
  modifiedTime: string | null;
  modifiedBy: string | null;
};

/**
 * The result of listing a folder.
 *
 * A status envelope rather than a throw, following the rule `getSlackChannels`
 * set: a read on a render path must never throw. The three failure states here
 * are all *ordinary* rather than exceptional, and each needs different words on
 * screen:
 *
 * - `reconnect` — this person never granted Drive, or their grant expired with no
 *   refresh token. Fixable by them, in one click.
 * - `no-access` — they aren't a member of the Lazer Home shared drive, or the
 *   folder was deleted in Drive. Fixable by someone else.
 * - `unavailable` — Drive timed out, rate-limited us, or 500'd. Fixable by waiting.
 *
 * Collapsing these into one "couldn't load files" would leave every one of them
 * looking like our bug.
 */
export type DriveFolderContents =
  | {
      status: "ok";
      entries: DriveEntry[];
      /**
       * True when the folder holds more direct children than one Drive page
       * returns, so `entries` is only part of it. Surfaced rather than swallowed:
       * a partial listing rendered as a complete one is how someone concludes a
       * file isn't there when it is.
       */
      truncated: boolean;
    }
  | { status: "reconnect" }
  | { status: "no-access" }
  | { status: "not-configured" }
  | { status: "unavailable" };

/**
 * List the contents of a folder in the Lazer Home shared drive.
 *
 * A client-triggered read, so it is an action rather than a `get*` function (the
 * interactive-read exception in `.claude/rules/server-actions.md`) — the Files tab
 * loads it on open so neither surface pays for it until someone looks.
 *
 * **Carries no capability, deliberately.** It runs on the viewer's own Google
 * token and `driveList` confines every query to the shared drive, so it can only
 * surface what that person could already see in Drive's own UI — Google enforces
 * shared-drive membership for us. A gate here would be theatre. See
 * docs/decisions/0069.
 *
 * `folderId` is any folder in the shared drive rather than only a linked one, so
 * the panel can navigate into subfolders. The breadcrumb is the client's job: it
 * pushes as you descend, which avoids walking `parents` upward one API call per
 * level on every load.
 */
export const loadDriveFolderContents = secureActionClient
  .metadata({ action: "load-drive-folder-contents" })
  .inputSchema(listDriveFolderSchema)
  .action(async ({ parsedInput: { folderId }, ctx: { user } }) => {
    if (!isDriveConfigured()) {
      return { status: "not-configured" } satisfies DriveFolderContents;
    }

    const accessToken = await getDriveAccessToken(user.id);
    if (!accessToken) {
      return { status: "reconnect" } satisfies DriveFolderContents;
    }

    try {
      const files = await driveList(
        `${driveQuoteValue(folderId)} in parents`,
        accessToken,
        { orderBy: "folder,name" },
      );

      const entries: DriveEntry[] = files.map((file) => ({
        id: file.id,
        name: file.name,
        isFolder: isDriveFolder(file.mimeType),
        webViewLink: file.webViewLink ?? null,
        modifiedTime: file.modifiedTime ?? null,
        modifiedBy: file.lastModifyingUser?.displayName ?? null,
      }));

      return {
        status: "ok",
        entries,
        truncated: files.length >= DRIVE_LIST_PAGE_SIZE,
      } satisfies DriveFolderContents;
    } catch (error) {
      return driveReadFailure(error, folderId);
    }
  });

/**
 * Map a failed listing onto the envelope. Kept beside the action because the
 * mapping is the whole reason the envelope has more than one failure case.
 */
function driveReadFailure(
  error: unknown,
  folderId: string,
): DriveFolderContents {
  if (error instanceof DriveApiError) {
    if (error.code === DRIVE_NOT_CONFIGURED)
      return { status: "not-configured" };
    if (error.status === 401) return { status: "reconnect" };
    if (error.status === 403 || error.status === 404) {
      return { status: "no-access" };
    }
    logger.warn("drive_list_failed", { folderId, code: error.code });
    return { status: "unavailable" };
  }
  // A timeout aborts rather than returning, so it lands here as a DOMException.
  logger.warn("drive_list_failed", { folderId, code: "unknown" });
  return { status: "unavailable" };
}
