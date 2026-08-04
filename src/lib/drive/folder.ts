/**
 * Google Drive folder naming and linking — the pure half.
 *
 * A pure, client-importable module: no `db`, no drizzle, no `@/env`. It lives in
 * its own `src/lib` folder rather than under a domain for the reason ADR 0036
 * gives about `src/lib/slack/channel.ts` — the feature spans two domains (CRM
 * owns the `sales` kind, Projects owns the `project` kind), so neither is its
 * home.
 *
 * Deliberately simpler than the Slack equivalent in two ways. Folder names are
 * the record's own name verbatim, because Drive has no slug rules to satisfy —
 * there is nothing to slugify and no prefix to strip back off for matching. And
 * a folder's URL needs no configuration, so `toDriveFolderRef` can live here in
 * the pure module rather than being server-only like `toSlackChannelRef`, which
 * needs `SLACK_TEAM_ID`.
 *
 * See docs/decisions/0069.
 */

/**
 * The two folder kinds, each owned by exactly one record type and managed only
 * on that record's own surface.
 */
export const DRIVE_FOLDER_KINDS = ["sales", "project"] as const;

export type DriveFolderKind = (typeof DRIVE_FOLDER_KINDS)[number];

/**
 * The folder each kind is created under, directly inside the Lazer Home shared
 * drive: `Lazer Home/Sales/<opportunity name>` and
 * `Lazer Home/Projects/<project name>`. Resolved by name at create time and
 * created if absent, so a fresh shared drive needs no manual setup.
 */
export const DRIVE_PARENT_FOLDER_NAME: Record<DriveFolderKind, string> = {
  sales: "Sales",
  project: "Projects",
};

/** Drive's own marker for "this file is a folder". */
export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * Drive accepts names up to 32767 characters, which is not a useful limit — it
 * would produce a folder no UI could render. Cap at a length that stays legible
 * in a breadcrumb and in Drive's own list.
 */
export const DRIVE_FOLDER_NAME_MAX = 255;

/**
 * The folder name for a record: its own name, tidied.
 *
 * Only whitespace is normalised. In particular `/` is left alone — it is a
 * legal character in a Drive name (Drive has no path syntax; parents are ids),
 * so stripping it would corrupt names like "Discovery / Scoping" for no gain.
 */
export function buildDriveFolderName(sourceName: string): string {
  const tidied = sourceName.replace(/\s+/g, " ").trim();
  return tidied.slice(0, DRIVE_FOLDER_NAME_MAX);
}

/** The human-facing link to a folder. Same URL shape for shared and My Drive. */
export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/**
 * A linked folder, ready to render: the stored id and display-snapshot name,
 * plus the link built from the id.
 */
export type DriveFolderRef = {
  id: string;
  name: string;
  url: string;
};

/**
 * Build a ref from a stored column pair, or null when the record has no folder.
 *
 * Both-or-neither mirrors the DB check constraint; a half-set pair can't exist,
 * so treating it as "not linked" is the safe reading rather than a silent bug.
 */
export function toDriveFolderRef(
  folderId: string | null,
  folderName: string | null,
): DriveFolderRef | null {
  if (!folderId || !folderName) return null;
  return { id: folderId, name: folderName, url: driveFolderUrl(folderId) };
}

/** Is this Drive entry a folder rather than a file? */
export function isDriveFolder(mimeType: string): boolean {
  return mimeType === DRIVE_FOLDER_MIME;
}

/**
 * The `q` fragment matching a name exactly, with Drive's quoting rules applied.
 *
 * Drive's query language delimits string literals with single quotes and escapes
 * a literal backslash or single quote with a backslash. Getting this wrong on a
 * folder named "Sam's deal" is not a cosmetic bug: the query fails to parse, the
 * "does this folder already exist" precheck errors out, and the create path
 * would make a duplicate instead of refusing. Every caller building a `q` with
 * user-controlled text must go through this.
 */
export function driveQuoteValue(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
