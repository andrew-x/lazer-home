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
 * See docs/decisions/0071.
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

/**
 * The one definition of "these two folder names are the same".
 *
 * Folds case and ignores surrounding whitespace. Drive itself treats "Acme" and
 * "acme" as different names and will happily hold both in one parent, but nobody
 * reading a folder list makes that distinction — so for our purposes they collide.
 * Shared by the conflict check and the suggestion so the dialog can never say a
 * name is free while the create path considers it taken.
 */
function normalizeFolderName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/** Is `name` already used by one of `taken`? */
export function driveFolderNameIsTaken(
  name: string,
  taken: Iterable<string>,
): boolean {
  const target = normalizeFolderName(name);
  for (const candidate of taken) {
    if (normalizeFolderName(candidate) === target) return true;
  }
  return false;
}

/**
 * The first name in the `base-1`, `base-2`, … series that nothing in `taken` is
 * using — a *suggestion* offered when `base` itself collides.
 *
 * Note what this is not: nothing applies it automatically. A colliding name blocks
 * creation and this is what the dialog offers as a way out, because the default
 * name is the record's own — which is exactly the name most likely to have been
 * taken already by someone creating the folder by hand. Silently suffixing would
 * hand back a folder the person never asked for and wouldn't notice.
 *
 * **The suffix is budgeted against the length cap**, so a name already at the limit
 * gets shortened to make room for `-12` instead of producing something Drive
 * rejects at the end of the flow.
 *
 * Termination needs no arbitrary cap: `taken` is finite, so at least one of the
 * `taken.size + 1` candidates tried must be free.
 */
export function suggestFreeDriveFolderName(
  base: string,
  taken: Iterable<string>,
): string {
  const used = new Set<string>();
  for (const name of taken) used.add(normalizeFolderName(name));

  for (let index = 1; index <= used.size + 1; index++) {
    const suffix = `-${index}`;
    const stem = base.slice(0, DRIVE_FOLDER_NAME_MAX - suffix.length);
    const candidate = `${stem}${suffix}`;
    if (!used.has(normalizeFolderName(candidate))) return candidate;
  }

  // Unreachable given the counting argument above. A plain Error rather than a
  // user-facing one: reaching here means the invariant is broken, which is a bug
  // to fix, not something to explain to whoever clicked the button.
  throw new Error(
    "suggestFreeDriveFolderName: no free name in a bounded series",
  );
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
