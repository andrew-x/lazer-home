"use server";

import { secureActionClient } from "@/lib/core/action";
import { logger } from "@/lib/core/logger";
import { SEARCH_LIMIT } from "@/lib/core/search";
import { DRIVE_FOLDER_MIME, driveQuoteValue } from "@/lib/drive/folder";
import { driveList, isDriveConfigured } from "./driveApi";
import { searchDriveFoldersSchema } from "./driveFolder.schema";
import { folderIdsAlreadyLinked } from "./driveFolderLink";
import { getDriveAccessToken } from "./driveToken";

/**
 * Type-ahead over folders in the Lazer Home shared drive, for the "link an
 * existing folder" picker.
 *
 * **No naming-convention filter, by design.** The search spans every folder in
 * the shared drive, not just the ones under `Sales`/`Projects`, because folders
 * that predate the convention are exactly the ones people most need to link — a
 * filter would hide the only results that matter. Creating is what enforces the
 * naming; linking adopts whatever is already there.
 *
 * Already-linked folders are filtered out, so the picker can't offer a folder
 * that will then be refused by `linkDriveFolder`. That check spans both kinds,
 * since cross-kind reuse is a UX mistake rather than a DB invariant.
 *
 * Returns an empty list rather than throwing on any failure: this feeds a
 * combobox, where "no matches" is a normal thing to render and an exception
 * would surface as a dead dropdown.
 */
export const searchDriveFolders = secureActionClient
  .metadata({ action: "search-drive-folders" })
  .inputSchema(searchDriveFoldersSchema)
  .action(async ({ parsedInput: { query }, ctx: { user } }) => {
    if (!query || !isDriveConfigured()) return [];

    const accessToken = await getDriveAccessToken(user.id);
    if (!accessToken) return [];

    try {
      const files = await driveList(
        `mimeType = ${driveQuoteValue(DRIVE_FOLDER_MIME)} and name contains ${driveQuoteValue(query)}`,
        accessToken,
        { orderBy: "name" },
      );

      // Take a shortlist first so the "already linked" lookup stays two indexed
      // queries over a handful of ids, not over everything Drive matched.
      const shortlist = files.slice(0, SEARCH_LIMIT * 2);
      const taken = await folderIdsAlreadyLinked(
        shortlist.map((file) => file.id),
      );

      return shortlist
        .filter((file) => !taken.has(file.id))
        .slice(0, SEARCH_LIMIT)
        .map((file) => ({ id: file.id, name: file.name }));
    } catch (error) {
      logger.warn("drive_folder_search_failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      return [];
    }
  });
