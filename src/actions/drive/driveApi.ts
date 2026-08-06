import "server-only";

import { z } from "zod";
import { env } from "@/env";
import {
  DRIVE_FOLDER_MIME,
  DRIVE_PARENT_FOLDER_NAME,
  type DriveFolderKind,
  driveQuoteValue,
} from "@/lib/drive/folder";
import {
  transcriptDocsQuery,
  transcriptFolderQuery,
} from "@/lib/drive/transcript";

/**
 * The Google Drive v3 transport: a few functions, deliberately not an SDK.
 *
 * Follows the posture ADR 0029 set and ADR 0067 extended: external I/O lives in
 * the actions layer, bare `fetch` with no vendor SDK (so no `googleapis`), the
 * untrusted response body is Zod-validated at the trust boundary, and every
 * request carries an abort signal.
 *
 * Three Drive-specific traps this exists to close:
 *
 * 1. **No caching, ever.** Slack's reads cache safely because there is one bot
 *    token for the whole workspace. Drive calls carry a PER-USER token, so a
 *    shared cache entry is a cross-user disclosure risk — one person's
 *    authorized listing served to another. Every request here is `no-store`,
 *    and this feature adds no cache tags. Do not "optimise" that.
 * 2. **`supportsAllDrives` is not optional.** Omit it and shared-drive calls
 *    fail in ways that read like permission errors, sending you hunting for the
 *    wrong bug.
 * 3. **Scope is not a parameter.** `driveList` hardcodes the shared drive, so no
 *    call site can widen a listing to the user's personal Drive. See the note
 *    on that function — it is the structural half of the privacy guarantee.
 *
 * ## The one exception, and how it is bounded (ADR 0072)
 *
 * ADR 0071 §1 promised that *nothing we run ever enumerates a personal Drive*.
 * Transcript triage cannot exist under that promise, so ADR 0072 amends it — as
 * narrowly as the feature allows. The replacement guarantee is that **the query
 * shape is not a parameter either**:
 *
 * - `personalScopedList` is the only function here that leaves the shared drive.
 *   It is **private**, so a free-form `q` against someone's own Drive is not
 *   reachable from outside this module.
 * - Its three callers (`driveFindTranscriptFolders`, `driveListTranscriptDocs`,
 *   `driveSearchTranscriptDocs`) each build their `q` from a fixed template in
 *   `@/lib/drive/transcript` — from a hardcoded folder-name list, or from folder
 *   ids already stored for that user. None accepts a caller-supplied query.
 *
 * So the total surface is: whether the caller owns folders with one of five exact
 * names, and the titles and dates of Google Docs directly inside them. Never
 * anything else they own, and never a file's contents. **Exporting
 * `personalScopedList`, or giving any of the three a `q`/`names` parameter, undoes
 * that bound** — which is the whole of what ADR 0072 spent. Don't.
 */

const DRIVE_TIMEOUT_MS = 10_000;

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

/**
 * Is the integration switched on?
 *
 * All three variables together, deliberately: browsing needs only the drive id,
 * but the Picker needs its own two, and a half-configured install where files
 * list yet nothing can be added is worse than a feature that is plainly off.
 * Must stay cheap and synchronous — callers use it to decide whether to render.
 */
export function isDriveConfigured(): boolean {
  return Boolean(
    env.GOOGLE_DRIVE_ROOT_ID &&
      env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY &&
      env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID,
  );
}

/** Thrown when a Drive call is attempted with no shared drive configured. */
export const DRIVE_NOT_CONFIGURED = "not_configured";

/**
 * A failed Drive call, carrying Drive's own machine-readable `reason` where it
 * gave one (`insufficientFilePermissions`, `cannotCopyFile`, `notFound`, …) so
 * the calling action can map the handful it has real copy for, plus the HTTP
 * status, since some outcomes are only distinguishable by it.
 */
export class DriveApiError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(`drive api error: ${code}`);
    this.name = "DriveApiError";
  }
}

function requireRootId(): string {
  const rootId = env.GOOGLE_DRIVE_ROOT_ID;
  if (!rootId) throw new DriveApiError(DRIVE_NOT_CONFIGURED);
  return rootId;
}

/** Params every Drive call needs for a shared drive to be visible at all. */
const SHARED_DRIVE_PARAMS = { supportsAllDrives: "true" } as const;

async function driveFetch<T extends z.ZodType>(
  path: string,
  init: RequestInit,
  accessToken: string,
  schema: T,
): Promise<z.infer<T>> {
  const res = await fetch(`${DRIVE_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
    },
    // See trap 1 above. Per-user tokens must never share a cache entry.
    cache: "no-store",
    signal: AbortSignal.timeout(DRIVE_TIMEOUT_MS),
  });

  return parseDriveResponse(res, schema);
}

/** A Drive read. */
export async function driveGet<T extends z.ZodType>(
  path: string,
  params: Record<string, string>,
  accessToken: string,
  schema: T,
): Promise<z.infer<T>> {
  const query = new URLSearchParams({
    ...SHARED_DRIVE_PARAMS,
    ...params,
  }).toString();
  return driveFetch(`${path}?${query}`, { method: "GET" }, accessToken, schema);
}

/** A Drive write (`files.create`, `files.copy`). */
export async function drivePost<T extends z.ZodType>(
  path: string,
  params: Record<string, string>,
  body: Record<string, unknown>,
  accessToken: string,
  schema: T,
): Promise<z.infer<T>> {
  const query = new URLSearchParams({
    ...SHARED_DRIVE_PARAMS,
    ...params,
  }).toString();
  return driveFetch(
    `${path}?${query}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    },
    accessToken,
    schema,
  );
}

/**
 * Delete a file or folder. Used only as the compensating action when a folder
 * was created but the DB link then lost a race — Drive having a real delete is
 * why that recovery is exact here, where Slack could only archive.
 *
 * Returns 204 with no body, so there is nothing to validate.
 */
export async function driveDelete(
  fileId: string,
  accessToken: string,
): Promise<void> {
  const query = new URLSearchParams(SHARED_DRIVE_PARAMS).toString();
  const res = await fetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?${query}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(DRIVE_TIMEOUT_MS),
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new DriveApiError(`http_${res.status}`, res.status);
  }
}

/** The subset of Drive's file resource any caller here reads. */
export const driveFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  webViewLink: z.string().nullish(),
  modifiedTime: z.string().nullish(),
  lastModifyingUser: z.object({ displayName: z.string().nullish() }).nullish(),
});

export type DriveFile = z.infer<typeof driveFileSchema>;

const driveFileListSchema = z.object({
  files: z.array(driveFileSchema).nullish(),
});

/**
 * The fields a full listing asks for — Drive returns ONLY what you name here, so
 * this list must stay in step with `driveFileSchema`, which parses the result.
 * Not exported: it is meaningless apart from that schema.
 */
const DRIVE_LIST_FIELDS =
  "files(id,name,mimeType,webViewLink,modifiedTime,lastModifyingUser(displayName))";

/**
 * Rows any single listing returns — Drive's own maximum for `files.list`.
 *
 * `driveList` fetches ONE page and does not follow `nextPageToken`. A folder with
 * more direct children than this is listed incompletely, so callers compare their
 * result length against this constant and say so rather than rendering a partial
 * listing as if it were the whole folder — the same honesty `getSlackChannels`
 * shows with its `degraded` flag. Paging the UI is out of scope; pointing at Drive
 * is the answer for a folder that big.
 */
export const DRIVE_LIST_PAGE_SIZE = 1000;

/**
 * List files inside the Lazer Home shared drive.
 *
 * **This function is the privacy guarantee, in code.** The drive scoping —
 * `corpora=drive`, `driveId=<the shared drive>` — is hardcoded rather than
 * passed, so no call site can widen a listing to the caller's personal Drive.
 * That is why every read goes through here instead of calling `driveGet`
 * directly, and why widening the signature to accept a `driveId` or `corpora`
 * would quietly undo the whole design (see docs/decisions/0071).
 *
 * `trashed = false` is appended for the same reason: a deleted-but-not-purged
 * file reappearing in a folder listing is never what anyone means.
 */
export async function driveList(
  q: string,
  accessToken: string,
  extraParams: Record<string, string> = {},
): Promise<DriveFile[]> {
  const result = await scopedList(
    q,
    accessToken,
    DRIVE_LIST_FIELDS,
    driveFileListSchema,
    extraParams,
  );
  return result.files ?? [];
}

/** Just the names of the folders directly under `parentId`. */
const driveNameListSchema = z.object({
  files: z.array(z.object({ id: z.string(), name: z.string() })).nullish(),
});

/**
 * The names of every folder directly under `parentId`, for the create path's
 * duplicate check.
 *
 * Its own function rather than `driveList` with a narrower `fields` because the
 * requested field list and the schema that parses the response **must agree**, and
 * a call site that passes only one of the pair silently breaks the other. That is
 * not hypothetical: asking `driveList` for `files(id,name)` while it parsed with a
 * schema requiring `mimeType` failed every response as `invalid_response`, which
 * surfaced as a generic "couldn't create the folder" — Drive returns exactly the
 * fields you ask for and nothing more. Pairing them here makes that undrifiable,
 * which is also why `scopedList` takes the two together.
 */
export async function driveListFolderNames(
  parentId: string,
  accessToken: string,
): Promise<string[]> {
  const result = await scopedList(
    `mimeType = ${driveQuoteValue(DRIVE_FOLDER_MIME)} and ${driveQuoteValue(parentId)} in parents`,
    accessToken,
    "files(id,name)",
    driveNameListSchema,
  );
  return (result.files ?? []).map((file) => file.name);
}

/**
 * The shared body of every listing, and the single place the shared-drive scoping
 * lives — see the note on `driveList`. `fields` and `schema` are one parameter pair
 * on purpose. `extraParams` is spread FIRST so it can add `orderBy` but can never
 * override the scoping or the field list; overriding either is how the privacy
 * guarantee or the response contract would quietly break.
 */
async function scopedList<T extends z.ZodType>(
  q: string,
  accessToken: string,
  fields: string,
  schema: T,
  extraParams: Record<string, string> = {},
): Promise<z.infer<T>> {
  const driveId = requireRootId();
  return driveGet(
    "/files",
    {
      ...extraParams,
      q: `(${q}) and trashed = false`,
      corpora: "drive",
      driveId,
      includeItemsFromAllDrives: "true",
      fields,
      pageSize: String(DRIVE_LIST_PAGE_SIZE),
    },
    accessToken,
    schema,
  );
}

// --- Personal-Drive reads (ADR 0072) ---------------------------------------
//
// Everything from here to `driveSearchTranscriptDocs` reads OUTSIDE the shared
// drive. Read the "one exception" note at the top of this file before changing any
// of it.

/**
 * The fields a transcript listing asks for, paired with the schema that parses it.
 *
 * Its own pair rather than reusing `DRIVE_LIST_FIELDS`/`driveFileSchema` because a
 * transcript needs `createdTime` (the meeting's date) and does not need
 * `lastModifyingUser` — and Drive returns **only** the fields you name, so a
 * projection that drifts from its schema fails every response as
 * `invalid_response`. See the note on `driveListFolderNames`.
 */
const DRIVE_TRANSCRIPT_FIELDS = "files(id,name,createdTime,webViewLink)";

export const driveTranscriptSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdTime: z.string().nullish(),
  webViewLink: z.string().nullish(),
});

export type DriveTranscript = z.infer<typeof driveTranscriptSchema>;

const driveTranscriptListSchema = z.object({
  files: z.array(driveTranscriptSchema).nullish(),
});

/**
 * The shared body of every personal-Drive listing — the deliberate counterpart to
 * `scopedList`, and the only place `corpora: "user"` appears.
 *
 * **Deliberately not exported.** `scopedList` is private because the shared-drive
 * scoping must not be overridable; this one is private for a stronger reason — an
 * exported version would be a general-purpose "ask anything about this person's
 * Drive" function, which is precisely what ADR 0071 §1 forbade and ADR 0072 did
 * *not* license. Its three callers below each hardcode their query shape.
 *
 * `extraParams` is spread FIRST for the same reason it is in `scopedList`: a caller
 * may add `orderBy`, but must not be able to override `corpora`, the field list or
 * the page size.
 */
async function personalScopedList<T extends z.ZodType>(
  q: string,
  accessToken: string,
  fields: string,
  schema: T,
  extraParams: Record<string, string> = {},
): Promise<z.infer<T>> {
  return driveGet(
    "/files",
    {
      ...extraParams,
      q: `(${q}) and trashed = false`,
      // The caller's own Drive — no `driveId`, no `includeItemsFromAllDrives`.
      corpora: "user",
      fields,
      pageSize: String(DRIVE_LIST_PAGE_SIZE),
    },
    accessToken,
    schema,
  );
}

/**
 * The caller's own transcript folders — the Meet and Tactiq drop folders.
 *
 * **Takes no name parameter.** The names come from `TRANSCRIPT_FOLDER_NAMES` via
 * `transcriptFolderQuery()`, which takes none either. Adding one turns this into a
 * folder search over a personal Drive.
 *
 * This is the *only* call that runs before we have any stored folder ids, which is
 * what makes it the discovery step — and what makes it the narrowest thing in the
 * feature: its answer is a subset of five known names.
 */
export async function driveFindTranscriptFolders(
  accessToken: string,
): Promise<Array<{ id: string; name: string }>> {
  const result = await personalScopedList(
    transcriptFolderQuery(),
    accessToken,
    "files(id,name)",
    driveNameListSchema,
  );
  return result.files ?? [];
}

/**
 * Google Docs inside `folderIds` created since `sinceIso`, newest meeting first.
 *
 * Returns `[]` for an empty `folderIds` rather than calling Drive:
 * `transcriptDocsQuery` returns `null` there precisely so this can't degrade into
 * listing every Doc the person owns, and this is the call site that honours it.
 */
export async function driveListTranscriptDocs(
  folderIds: readonly string[],
  sinceIso: string,
  accessToken: string,
): Promise<DriveTranscript[]> {
  const q = transcriptDocsQuery(folderIds, { sinceIso });
  if (!q) return [];

  const result = await personalScopedList(
    q,
    accessToken,
    DRIVE_TRANSCRIPT_FIELDS,
    driveTranscriptListSchema,
    { orderBy: "createdTime desc" },
  );
  return result.files ?? [];
}

/**
 * Google Docs inside `folderIds` whose name contains `term`, **across all time**.
 *
 * Search deliberately ignores the triage window: someone searching by name is
 * looking for a specific meeting, and silently confining that to the last seven
 * days is how they conclude a transcript isn't there when it is. The widget says so
 * on screen. Same empty-`folderIds` guard as the listing above.
 */
export async function driveSearchTranscriptDocs(
  folderIds: readonly string[],
  term: string,
  accessToken: string,
): Promise<DriveTranscript[]> {
  const q = transcriptDocsQuery(folderIds, { nameContains: term });
  if (!q) return [];

  const result = await personalScopedList(
    q,
    accessToken,
    DRIVE_TRANSCRIPT_FIELDS,
    driveTranscriptListSchema,
    { orderBy: "createdTime desc" },
  );
  return result.files ?? [];
}

// --- Back inside the shared drive ------------------------------------------

export const driveFileWithParentsSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  parents: z.array(z.string()).nullish(),
  /**
   * The shared drive this file belongs to, absent for a file in someone's own
   * Drive. Both link and copy compare it against `GOOGLE_DRIVE_ROOT_ID` to keep
   * folders and their contents inside Lazer Home.
   */
  driveId: z.string().nullish(),
  /**
   * When the file was created — for a transcript, when the meeting happened.
   * Snapshotted onto a triage row so the archive can still date a transcript whose
   * source has since been renamed, moved or deleted.
   */
  createdTime: z.string().nullish(),
});

/**
 * Read one file's metadata. Used to check a link target and to name a copy.
 *
 * The field list is fixed rather than a parameter, for the reason spelled out on
 * `driveListFolderNames`: a caller narrowing it would leave
 * `driveFileWithParentsSchema` unable to parse the response, and the failure
 * surfaces as a generic error rather than as the mismatch it is.
 */
export async function driveGetFile(
  fileId: string,
  accessToken: string,
): Promise<z.infer<typeof driveFileWithParentsSchema>> {
  return driveGet(
    `/files/${encodeURIComponent(fileId)}`,
    // Must stay in step with `driveFileWithParentsSchema` — Drive returns only the
    // fields named here, and a projection narrower than the schema fails every
    // response as `invalid_response`.
    { fields: "id,name,mimeType,parents,driveId,createdTime" },
    accessToken,
    driveFileWithParentsSchema,
  );
}

/** Create a folder under `parentId`. */
export async function driveCreateFolder(
  name: string,
  parentId: string,
  accessToken: string,
): Promise<DriveFile> {
  return drivePost(
    "/files",
    { fields: "id,name,mimeType,webViewLink" },
    { name, mimeType: DRIVE_FOLDER_MIME, parents: [parentId] },
    accessToken,
    driveFileSchema,
  );
}

/**
 * Find a folder by exact name under a parent, or null.
 *
 * Not exported: the parent-folder resolvers below are the only callers. The create
 * path deliberately does NOT use this to check its own folder name — it lists the
 * parent's names once via `driveListFolderNames` and compares with
 * `driveFolderNameIsTaken`, so the dialog's live check and the server's refusal read
 * the same rule.
 *
 * Returns the OLDEST match, so a concurrent double-create of a parent folder
 * (Drive permits duplicate names) converges on one rather than forking.
 */
async function driveFindFolderByName(
  name: string,
  parentId: string,
  accessToken: string,
): Promise<DriveFile | null> {
  const files = await driveList(
    `mimeType = ${driveQuoteValue(DRIVE_FOLDER_MIME)} and name = ${driveQuoteValue(name)} and ${driveQuoteValue(parentId)} in parents`,
    accessToken,
    { orderBy: "createdTime" },
  );
  return files.at(0) ?? null;
}

/**
 * The `Sales` or `Projects` folder at the root of the shared drive, or null when it
 * doesn't exist yet.
 *
 * Separate from `resolveParentFolder` because the name-availability check must not
 * have side effects: it fires when the create dialog merely *opens*, and creating
 * `Sales/` for someone who then cancels would leave a folder nobody asked for.
 */
export async function findParentFolder(
  kind: DriveFolderKind,
  accessToken: string,
): Promise<string | null> {
  const rootId = requireRootId();
  const existing = await driveFindFolderByName(
    DRIVE_PARENT_FOLDER_NAME[kind],
    rootId,
    accessToken,
  );
  return existing?.id ?? null;
}

/**
 * The same folder, created if it isn't there yet — so a fresh shared drive needs no
 * manual folder setup. For the create path, which is already committing to a write.
 *
 * Resolved on each create rather than cached, because creates are rare and caching
 * a per-user Drive read is exactly what trap 1 forbids.
 */
export async function resolveParentFolder(
  kind: DriveFolderKind,
  accessToken: string,
): Promise<string> {
  return resolveChildFolder(
    DRIVE_PARENT_FOLDER_NAME[kind],
    requireRootId(),
    accessToken,
  );
}

/**
 * A folder of this name directly under `parentId`, created if absent — the general
 * form `resolveParentFolder` is now expressed in terms of.
 *
 * Extracted for the `<record folder>/Transcripts` subfolder, which needs exactly
 * this and must not grow a second find-or-create that could drift from it. Note
 * both uses stay **inside the shared drive**: it resolves through
 * `driveFindFolderByName` → `driveList`, so it cannot create or find anything in a
 * personal Drive.
 *
 * It inherits `driveFindFolderByName`'s oldest-match-first behaviour, so two people
 * filing a transcript into a fresh record folder at the same moment converge on one
 * `Transcripts` folder rather than each getting their own.
 */
export async function resolveChildFolder(
  name: string,
  parentId: string,
  accessToken: string,
): Promise<string> {
  const existing = await driveFindFolderByName(name, parentId, accessToken);
  if (existing) return existing.id;

  const created = await driveCreateFolder(name, parentId, accessToken);
  return created.id;
}

/**
 * Turn a Drive HTTP response into either validated data or a `DriveApiError`.
 *
 * Unlike Slack, Drive uses real status codes, so `res.ok` is meaningful here.
 * The reason string inside the error body is still worth extracting: 403 covers
 * both "you can't write to this shared drive" and "the owner blocked copying",
 * which need different copy.
 */
async function parseDriveResponse<T extends z.ZodType>(
  res: Response,
  schema: T,
): Promise<z.infer<T>> {
  if (!res.ok) {
    const reason = await readDriveErrorReason(res);
    throw new DriveApiError(reason ?? `http_${res.status}`, res.status);
  }

  const body: unknown = await res.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // A 200 we can't read is a contract break on their side or ours; either way
    // it must not be treated as usable data.
    throw new DriveApiError("invalid_response", res.status);
  }
  return parsed.data;
}

const driveErrorSchema = z.object({
  error: z.object({
    errors: z.array(z.object({ reason: z.string().nullish() })).nullish(),
    message: z.string().nullish(),
  }),
});

async function readDriveErrorReason(res: Response): Promise<string | null> {
  try {
    const parsed = driveErrorSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    return parsed.data.error.errors?.at(0)?.reason ?? null;
  } catch {
    // A non-JSON error body (a proxy page, a truncated response) is not itself
    // an error worth surfacing — the status code still tells the caller enough.
    return null;
  }
}
