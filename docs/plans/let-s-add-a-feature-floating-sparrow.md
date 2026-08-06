# Meeting-transcript triage — from a personal Drive into the record it belongs to

## Context

Meeting transcripts are the highest-signal artefact the business produces and the
worst-filed. Google Meet and Tactiq drop a Google Doc into a folder in whoever ran the
call's **personal** Drive (`Google Meet`, `Meet Recordings`, `Legacy Meet Recordings`,
`Tactiq Transcription`, `Tactiq Transcriptions`), where it stays. ADR 0071 has just
connected opportunities and projects to folders in the **Lazer Home** shared drive, so
there is now somewhere for a transcript to belong — but nothing carries it across, and
nobody is going to do it by hand after every call.

The outcome: a **Triage** widget on the home dashboard listing your recent transcripts,
where one click files a copy into the right opportunity or project's Drive folder under
`/Transcripts`.

### This feature deliberately spends ADR 0071's central invariant

ADR 0071 §1 guarantees, structurally rather than by policy, that **nothing we run ever
enumerates a personal Drive** — `driveList` hardcodes the shared drive and "scope is not
a parameter… not by accident and not by a future 'just add an optional `driveId`'".

This feature cannot exist without reading a personal Drive. That is a real cost, taken
knowingly, and it is bounded by §2 below rather than waved through. **`driveList` itself
is not touched** — widening it is the one thing the invariant exists to prevent, and six
existing call sites depend on it staying narrow.

### Three decisions taken by the user, recorded because they are not the defaults I'd pick

1. **Discovery is silent.** The folder search runs without asking, on first widget load.
   The alternative — a one-time "find my transcript folders" confirm — was declined. The
   ADR must record that the amendment therefore rests on the code's bounds alone, with no
   user consent action underneath it.
2. **Assigning requires the record's own edit capability** (`crm.edit` / `projects.edit`).
   Consequence: an ordinary `user` — a consultant who sat in the meeting — sees their
   transcripts and can dismiss them but **cannot file any of them**. A `sales` user can
   file to a deal but not to the project it became; a `delivery-manager` the reverse.
3. **Both target searches are open to every signed-in user.** This newly discloses the
   full opportunity list (client and deal names) by type-ahead to employees who cannot
   assign anything — nothing on the platform does this today. Raised twice and reaffirmed
   both times. It must be written down as an accepted cost in the ADR *and* in
   `docs/domains/permissions.md`, not left for `/audit-rbac` to discover.

---

## 1. Data model — two tables

Both in a new `src/lib/db/drive-schema.ts`, barrelled from `src/lib/db/schema.ts`. Follow
`tasks-schema.ts` as the shape model (banner comment, `(t) => [check(…), index(…)]`,
`InferSelectModel` row types at the bottom).

**FKs point at `user`, not `staff`** — the Drive grant lives on the auth account and
`getDriveAccessToken` takes a `userId`. A staff record is the wrong key here.

### `drive_transcript_folders` — the read boundary, not a cache

```
id            text pk                       generateId("dtf")
userId        text not null → user.id cascade
driveFolderId text not null
folderName    text not null                 display snapshot, per ADR 0071 §9
createdAt     timestamp
uniqueIndex("drive_transcript_folders_user_folder_idx").on(userId, driveFolderId)
index("drive_transcript_folders_user_idx").on(userId)
```

This table is **the thing that bounds every personal read**: `driveListTranscriptDocs`
takes its parent ids from here and nowhere else. It is not a cache of a Drive listing
(ADR 0071 §4 forbids those) — it is per-user rows keyed on `userId`, so the cross-user
disclosure §4 exists to prevent cannot occur. Say so in the ADR; the resemblance will
otherwise read as a violation.

### `transcript_assignments` — a record of *our* action

```
id             text pk                      generateId("tra")
userId         text not null → user.id cascade
driveFileId    text not null                the SOURCE doc in the personal Drive
fileName       text not null                snapshot, for the archive after the copy
fileCreatedAt  timestamp                    the transcript's own date, snapshotted
dismissed      boolean not null default false
opportunityId  text → opportunities.id cascade
projectId      text → projects.id cascade
copiedFileId   text                         the copy in the shared drive
createdAt      timestamp
```

Constraints:

```
check("transcript_assignments_shape",
  sql`(${dismissed} and num_nonnulls(${opportunityId}, ${projectId}) = 0
       and ${copiedFileId} is null)
   or (not ${dismissed} and num_nonnulls(${opportunityId}, ${projectId}) = 1
       and ${copiedFileId} is not null)`)

-- Postgres treats NULLs as distinct, so each of these constrains only its own kind.
uniqueIndex("transcript_assignments_project_idx").on(userId, driveFileId, projectId)
uniqueIndex("transcript_assignments_opportunity_idx").on(userId, driveFileId, opportunityId)
uniqueIndex("transcript_assignments_dismissed_idx").on(userId, driveFileId).where(sql`${dismissed}`)
index("transcript_assignments_user_idx").on(userId, driveFileId)
```

A file may be filed to several records (the user chose *keep, badged*), so nothing stops
two rows for one file — but not the *same* record twice, and only one dismissal.

**ADR 0071 rejected "per-file records in our DB".** It rejected a **mirror** of folder
contents, which goes stale the moment someone uses Drive directly. This records who filed
what, where, and when — not derivable from Drive at all. The ADR must draw that
distinction explicitly, because the sentence as written looks like it forbids this table.

Migration: `bun run db:generate` → `bun run db:migrate`. Add both table names to
`SEEDABLE_TABLES` in `scripts/seed/wipe.ts` (child → parent, above `user`). **No seed
data** — ADR 0071 §12's reasoning holds exactly: a fake Drive id renders a row that
errors inside Drive while leaving the empty state and the assign dialog unexercised.

---

## 2. The bounded personal read — `src/lib/drive/transcript.ts` + `driveApi.ts`

The security core of the change. Review this part hardest.

### The pure module (`src/lib/drive/transcript.ts`, + `transcript.test.ts`)

Client-importable, no `db`/drizzle/`@/env` — sibling of `folder.ts` under ADR 0036.

```ts
export const TRANSCRIPT_FOLDER_NAMES = [
  "Google Meet", "Meet Recordings", "Legacy Meet Recordings",
  "Tactiq Transcription", "Tactiq Transcriptions",
] as const;
export const TRANSCRIPTS_SUBFOLDER_NAME = "Transcripts";
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
export const TRIAGE_WINDOW_DAYS = [7, 30, 90] as const;   // "show more" ladder

/** q matching the transcript folders by name. Takes NO parameters, by design. */
export function transcriptFolderQuery(): string;

/**
 * q for Docs inside `folderIds`. Returns **null** for an empty `folderIds` — an
 * empty parents clause degrades into "every Doc in your Drive", which is the exact
 * failure this whole design exists to prevent.
 */
export function transcriptDocsQuery(
  folderIds: string[],
  opts: { sinceIso?: string; nameContains?: string },
): string | null;
```

Both build through the existing `driveQuoteValue` from `folder.ts`. Tests (the sanctioned
ADR 0037 exception, same grounds as `folder.test.ts` — this is pure logic where a mistake
is silent and severe):

- **empty `folderIds` → `null`, always.** The single most important test in the change.
- a folder name and a search term containing `'` and `\` quote correctly
- all five names appear in the folder query; no sixth
- the Docs query always carries both the mime filter and a parents clause

### The second lister (`src/actions/drive/driveApi.ts`)

Add a **private** `personalScopedList` beside the existing private `scopedList`. It
hardcodes `corpora: "user"` and appends `and trashed = false`, takes the `fields`/`schema`
pair together (per the documented drift trap), and **is not exported** — so a free-form
`q` against a personal Drive is not reachable from outside this module.

Three exported callers, each with a **fixed query shape**:

```ts
/** The user's transcript folders. Takes no name parameter — adding one reopens the scope. */
export async function driveFindTranscriptFolders(accessToken: string): Promise<DriveFile[]>

/** Docs in `folderIds` created since `sinceIso`. Returns [] when folderIds is empty. */
export async function driveListTranscriptDocs(
  folderIds: string[], sinceIso: string, accessToken: string,
): Promise<DriveTranscript[]>

/** Docs in `folderIds` whose name contains `term`, all time. Returns [] when empty. */
export async function driveSearchTranscriptDocs(
  folderIds: string[], term: string, accessToken: string,
): Promise<DriveTranscript[]>
```

The invariant restated for the file's banner comment: **the query shape is not a parameter
either.** The blast radius is exactly — whether you own folders with those five names, and
the titles/dates of Docs directly inside them. Never anything else you own, never file
contents.

New `fields`/schema pair (`createdTime` is not on the existing `driveFileSchema`, and
Drive returns only what you name — mismatching them fails every response as
`invalid_response`, surfacing as a generic error):

```ts
const DRIVE_TRANSCRIPT_FIELDS = "files(id,name,createdTime,webViewLink)";
export const driveTranscriptSchema = z.object({
  id: z.string(), name: z.string(),
  createdTime: z.string().nullish(), webViewLink: z.string().nullish(),
});
```

Ordering: `{ orderBy: "createdTime desc" }`. `createdTime`, not `modifiedTime` — a
transcript's date is when the meeting happened; an edit two weeks later must not refloat it.

### One small refactor for `/Transcripts`

`resolveParentFolder(kind, token)` already does find-or-create-by-name at the drive root,
via the private `driveFindFolderByName` (which correctly runs through the **shared-drive**
`driveList` — `/Transcripts` lives in the shared drive). Extract the general form and
express the existing function in terms of it, so there is one find-or-create:

```ts
export async function resolveChildFolder(
  name: string, parentId: string, accessToken: string,
): Promise<string>

// resolveParentFolder(kind, token) → resolveChildFolder(DRIVE_PARENT_FOLDER_NAME[kind], requireRootId(), token)
```

It inherits the oldest-match-by-`createdTime` behaviour, so two people filing transcripts
into a fresh record folder at once converge on one `/Transcripts` rather than forking.

---

## 3. Actions — `src/actions/drive/`

### Extract the folder-create body first

`assignTranscript` must be able to create a record's folder, and **an action cannot call
another action.** Extract `createDriveFolder`'s body verbatim into a `server-only`
`createRecordFolder.ts`, and have both the existing action and `assignTranscript` call it.
Do not reimplement it: its step order *is* the design (precheck → resolve parent →
name-collision refusal → create → `isNull`-guarded link → compensating `driveDelete`), and
a second copy will drift out of that order.

### The four new actions

| File | Input | Gate | Notes |
|---|---|---|---|
| `getTranscriptTriage.ts` | `{ days }` | signed-in | client-triggered read, status envelope |
| `searchTranscripts.ts` | `{ query }` | signed-in | Drive-side name search, **all time** |
| `assignTranscript.ts` | `{ fileId, kind, recordId, confirmCreateFolder }` | `authorizeDriveFolder` | the mutation |
| `dismissTranscript.ts` | `{ fileId, dismissed }` | signed-in | own rows only |
| `searchTranscriptTargets.ts` | `{ kind, query }` | **none — see §5** | the disclosure surface |

The three ungated reads follow ADR 0071 §7's reasoning as-is: they run on the viewer's own
token over their own Drive and their own rows, so there is nothing a gate could add.
`dismissTranscript` is own-data-only by construction (keyed on `ctx.user.id`, never an
input id), the `getMyTasks` shape — so there is no ownership check to get wrong.

**`getTranscriptTriage`** — a `'use server'` action rather than a `server-only get*`, under
the documented interactive-read exception, because it must **not** run on `/`'s server
render. ADR 0071 §11 kept both existing surfaces free of a Drive round-trip; the home
dashboard is a worse place to spend two uncacheable per-user Drive calls than either. The
widget loads its own contents on mount, the Files-tab idiom. This still satisfies the
"silent discovery, no prompt" decision — nobody is asked anything.

Body: `isDriveConfigured()` → `getDriveAccessToken` (null → `reconnect`) → read stored
folders → **if none, `driveFindTranscriptFolders` and insert them** (the silent discovery;
`onConflictDoNothing` on the unique index so two tabs racing converge) → `driveListTranscriptDocs`
over the stored ids for the window → left-join `transcript_assignments` for this user →
project to a whitelisted view.

Returns the ADR 0071 §10 envelope, extended with one case:

```ts
export type TranscriptTriage =
  | { status: "ok"; transcripts: TranscriptView[]; truncated: boolean }
  | { status: "no-folders" }        // NEW: Drive works, no transcript folders exist
  | { status: "reconnect" } | { status: "no-access" }
  | { status: "not-configured" } | { status: "unavailable" };
```

`no-folders` earns its own case for §10's stated reason — collapsing it into an empty `ok`
would render "no transcripts this week" at someone who has never recorded a meeting, and
at someone whose folder is named something we don't look for. Different people, different
fixes; the copy should name the five folder names it looked for.

**`assignTranscript`** — not transactional with Drive, so the step order is the design,
mirroring `createDriveFolder`:

1. `DRIVE_FOLDER_TARGETS[kind].read(recordId)` — reject a missing record.
2. Reject a duplicate assignment (the unique index is the real defence; this is the
   readable error) and confirm the source doc sits in one of *this user's* stored
   transcript folders, via its `parents`. Not a security boundary — `copyDriveFile` already
   copies any picked file — but it keeps a "transcript assignment" actually about a
   transcript.
3. **No record folder yet?** Return `{ status: "needs-folder", recordName, folderName }`
   without touching Drive, unless `confirmCreateFolder` is set. The user asked for a
   confirm here, and it is also where the capability bites: a non-editor never reaches
   this action at all, so the dialog must say *"ask a delivery manager to set up this
   project's Drive folder first"* rather than offering a button that 403s.
   With the flag set → `createRecordFolder(kind, recordId, buildDriveFolderName(record.sourceName), token)`.
4. `resolveChildFolder(TRANSCRIPTS_SUBFOLDER_NAME, recordFolderId, token)`.
5. `files.copy` into it — name from the source read server-side, never the client's.
6. Insert the assignment row. **If the insert fails, `driveDelete` the copy** — exact
   compensation, seconds-old file, the same strictly-better-than-Slack recovery ADR 0071 §8
   describes. If that also fails, `logger.error("transcript_copy_orphaned", …)`.
7. `target.revalidate(recordId)` + `revalidatePath("/")`.

Reuse `copyFailureError`'s mapping from `copyDriveFile` (extract it if it stays identical —
`cannotCopyFile` is the likeliest real failure and only the file's owner can undo it).
**No cache tags** anywhere in this feature, per ADR 0071 §4.

---

## 4. UI — `src/components/home/`

`transcript-triage-panel.tsx` (`"use client"`), plus `transcript-row.tsx` and
`transcript-assign-dialog.tsx`. Mounted in `YourStatusSection`
(`src/app/(app)/page.tsx`) after `<MyTasksPanel>`.

Placement follows ADR 0065's precedent — a point-in-time block inside a year-to-date band —
so the band description stays window-neutral and **this block names its own window**
(*"Transcripts from your Drive · last 7 days"*, and the actual dates as the window grows).
ADR 0063's rule applies unchanged.

- **Load on mount** via `useAction(getTranscriptTriage)`; handle all six envelope cases.
  `reconnect` renders `<DriveReconnectButton />` inline, as `drive-files-panel.tsx` does.
- **Search is server-side and debounced**, unlike `MyTasksPanel`'s in-memory
  `filterMyTasks`. This is the one deliberate divergence from the task list and needs a
  comment saying why: transcripts live in Drive, not in the payload, so filtering the
  loaded window would silently hide the older file someone is searching *for*. The results
  header must say the search covers all time, not the window.
- **Show more** re-executes with the next `TRIAGE_WINDOW_DAYS` step.
- **Assign** opens a dialog built from the vendored `Dialog` primitives (not `FormDialog` —
  that shell is for forms), with a kind toggle and an `EntityCombobox` over
  `searchTranscriptTargets`. Hide the half the viewer can't act on rather than showing
  disabled options. Then the `needs-folder` confirm as a second step in the same dialog.
- **Assigned rows stay, badged** with an `InternalLink` to the record and a Drive link to
  the copy; **dismissed rows** hide, with an archive dialog (`task-archive-dialog.tsx` as
  the model) to see and undo them.
- `nowMs` stamped on the server for any staleness/relative-date rendering, per ADR 0065.
- Literal apostrophes, `IconButton` for icon-only controls, `render={…}` not `asChild`.

**Payload discipline (ADR 0063 §5).** `TranscriptView` carries a whitelist doc comment and
one `toTranscriptView(row)` projector that **copies field by field and spreads nothing** —
`{ fileId, name, createdAt (epoch ms), webViewLink, assignments: [{ kind, recordId, recordName, copyUrl }] }`.
No `userId`, no folder ids. Add a `JSON.stringify(payload)).not.toContain(…)` test in the
`org-status.test.ts` style.

---

## 5. Permissions — one new capability-free gate and one accepted disclosure

**No new capability, no matrix change.** `authorizeDriveFolder` already resolves
`crm.edit` | `projects.edit` from the `kind` discriminant off raw `clientInput`, denying an
unparseable kind rather than skipping — `assignTranscript` reuses it unchanged. ADR 0014's
lockstep rule stays disengaged, so `permissions.ts`, `permissions.test.ts` and the matrix
table are untouched.

**`searchTranscriptTargets` is ungated, and that is a disclosure.** One action rather than
two, kind-discriminated, so the whole disclosure is a single auditable surface. It must
carry a prominent comment stating it is deliberately ungated by decision, and
`docs/domains/permissions.md` must gain a prose entry in its "gates outside the matrix"
section recording:

> Any signed-in user can enumerate every project and every open opportunity by name
> through `searchTranscriptTargets`, including those they cannot assign to. Accepted
> deliberately (see ADR 0072); the opportunity list is not otherwise disclosed outside
> `crm.edit`.

Without that entry `/audit-rbac` will correctly flag this as a leak on the next run.

Do **not** loosen the existing `searchProjects` — other callers rely on its `projects.edit`
gate. Reuse the query body via `src/actions/shared/entitySearch.ts`, the convention
`searchStaffByName` established.

---

## 6. Verification

I can't run the app (hard rule), so evidence is compile-time plus the pure tests, and
runtime checks are yours.

**Mine:**
- `bun run check` — Biome, `tsc --noEmit`, `bun test` (includes the RBAC matrix and the new
  `transcript.test.ts`). Must be green.
- `bun run build`.
- `bun run db:generate` → review the SQL by hand: 2 `CREATE TABLE`, the shape check, three
  unique indexes, no unintended drops. Then `bun run db:migrate`.
- `/audit-rbac` and `/code-review`, and address what they find. The RBAC audit will surface
  the ungated search — confirm it lands as *documented and accepted*, not as a finding.
- Grep proof of the invariant: `driveList`'s signature unchanged, `personalScopedList` not
  exported, and no call site passing a free-form `q` to a personal read.

**Yours, in the running app:**
1. `/` loads with no Drive round-trip on the server render; the Triage widget populates
   after mount. Confirm the dashboard isn't slower.
2. A fresh account (no Drive scope) shows `reconnect`; the button restores it via
   `linkSocial` without losing the session.
3. An account with a `Meet Recordings` folder: transcripts list newest-first with the right
   dates. An account with none shows `no-folders` naming the five folders.
4. Assign to a project **with** a folder → the Doc appears in `<project>/Transcripts` in
   Drive, the original stays in your own Drive, the row shows the badge.
5. Assign to a project with **no** folder → the confirm appears, then both the record
   folder and `/Transcripts` are created.
6. As a `user` (no `crm.edit`/`projects.edit`): the list and dismiss work; no assign is
   offered. As `sales`: opportunities only. As `delivery-manager`: projects only.
7. Search finds a transcript older than the window.
8. Dismiss hides it; the archive dialog restores it.

**Docs** — dispatch the `librarian` subagent afterwards with a summary: new **ADR 0072**
amending ADR 0071 §1 (bounded personal reads), §4 (why the folder table isn't a cache) and
its "no per-file records" rejection; updates to `docs/domains/drive.md`,
`docs/domains/crm.md`, `docs/domains/permissions.md` and `docs/data-model.md`.
