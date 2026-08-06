# 0072 — Meeting-transcript triage: spending ADR 0071 §1's invariant, and the bound that replaces it

**Status:** accepted · 2026-08-05 · **amends [ADR 0071](./0071-google-drive-folder-links-per-user-oauth-and-the-privacy-invariant.md) §1**
— the first and only amendment to the privacy invariant, and the reason to read this ADR before
touching anything under `src/actions/drive/` · builds on 0071 in every other respect (per-user OAuth,
the full `drive` scope, **zero cache tags**, copies-never-moves, the status-envelope discipline) ·
the gate is 0071 §7's `authorizeDriveFolder` **unchanged**, so **no capability and no matrix change**
([ADR 0014](./0014-rbac-better-auth-access-control.md)'s lockstep rule is not engaged) · the payload
obeys [ADR 0063](./0063-home-dashboard-two-time-bases-and-point-in-time-staffing.md) §5's whitelist
rule and the widget sits in *Your Status* beside the task list of
[ADR 0065](./0065-home-personal-task-list-and-assignee-completion.md) · migration
`drizzle/0030_useful_northstar.sql` (two new tables) · knowledge:
[`domains/drive.md`](../domains/drive.md) · runbook **unchanged** —
[`guides/google-drive.md`](../guides/google-drive.md) needs no new env var and no new scope

## Context

Google Meet and Tactiq write a meeting transcript as a Google **Doc** into a folder in the personal
Drive of whoever recorded it. Those transcripts are the single richest record of a sales call or a
delivery check-in, and today they die there: nobody copies them into the deal's or the project's
folder, because doing it by hand means opening Drive, finding the file, finding the record's folder,
and copying — for every call, forever.

The feature is a **Triage** widget on the home dashboard: the transcripts sitting in *your own*
Drive, each with one click to file a copy into the opportunity or project it belongs to, under
`<record folder>/Transcripts`.

**This cannot exist under ADR 0071 §1 as written.** That section's first guarantee is that
*"nothing we run ever enumerates a personal Drive"*, enforced structurally: `driveList` hardcodes
`corpora=drive` + `driveId=GOOGLE_DRIVE_ROOT_ID`, and **scope is not a parameter**. The only path
that ever touched a personal file was `copyDriveFile`, whose id came from the user's own click in
the Google Picker. Listing someone's transcript folder is exactly the enumeration that guarantee
forbade.

So this ADR is mostly about what replaces it. The rest of 0071 stands untouched.

## Decision

### 1. The amendment: scope stops being the bound; **query shape** becomes the bound

`driveList` is **not modified.** Every shared-drive read still goes through it, still hardcoded, and
its doc comment still says scope is not a parameter. What was added beside it is a second, private
door.

**`personalScopedList` (`src/actions/drive/driveApi.ts`) is the only function in the repo that
leaves the shared drive.** It hardcodes `corpora: "user"` (no `driveId`, no
`includeItemsFromAllDrives`) and it is **not exported**. That is the whole substitute guarantee: an
exported version would be a general-purpose *"ask anything about this person's Drive"* function,
which is precisely what 0071 §1 forbade and what this ADR does **not** license.

Its three callers each build their `q` from a fixed template in `src/lib/drive/transcript.ts`, and
none accepts a caller-supplied query:

| Caller | Query it builds | Parameters it takes |
|---|---|---|
| `driveFindTranscriptFolders` | `transcriptFolderQuery()` — folders named one of five exact names | **none** (not even the names) |
| `driveListTranscriptDocs` | `transcriptDocsQuery(folderIds, { sinceIso })` | folder ids **already stored for that user**, a date |
| `driveSearchTranscriptDocs` | `transcriptDocsQuery(folderIds, { nameContains })` | the same folder ids, a name substring |

**The total surface of what we can learn about a personal Drive is therefore:** whether you own a
folder called `Google Meet`, `Meet Recordings`, `Legacy Meet Recordings`, `Tactiq Transcription` or
`Tactiq Transcriptions`; and the **titles and creation dates** of the Google Docs directly inside
those folders. Never anything else you own, never a folder we didn't name, never a file's contents.

Three tripwires, in the order someone is likeliest to trip them:

1. **Exporting `personalScopedList` undoes all of it.** So does giving any of the three callers a
   `q` or a `names` parameter, or making `TRANSCRIPT_FOLDER_NAMES` configurable. Adding a *name* to
   that list widens the surface and is a decision for this ADR, not a config tweak.
2. **`transcriptDocsQuery` returns `null` for an empty folder list, and every caller must honour
   it.** This is the single most dangerous edge in the feature: an empty `parents` clause either
   collapses to `()` (which Drive rejects) or, written slightly differently, **disappears — leaving
   `mimeType = document`, which lists every Google Doc the person owns.** Failing closed with a
   sentinel the type system forces callers to handle is the only version of this that can't
   silently regress. `src/lib/drive/transcript.test.ts` (13 tests) pins it as the most important
   assertion in the file.
3. **The query builders live in the pure module, not inline in the transport**, specifically so they
   are testable. The bounds *are* the security property, and an untested security property is a
   claim rather than a bound.

**What is preserved from §1:** it still **copies, never moves** — nothing anywhere rewrites a file's
`parents`, so filing a transcript cannot remove it from the person's own Drive. The Picker path,
`copyDriveFile`'s shared-drive destination confinement, and `linkDriveFolder`'s `driveId` refusal are
all untouched.

### 2. Discovery is **silent** — a decision taken against the recommended default

The first time the widget loads, `resolveTranscriptFolders` searches the user's own Drive for the
five names and stores what it finds. **Nobody is asked first.**

A one-time *"find my transcript folders?"* confirmation was offered and **declined**. Recording that
plainly, because it is the load-bearing consequence: **the amendment in §1 rests on the code's bounds
alone, with no user consent action underneath it.** If the bounds are ever widened, there is no
second layer to catch it.

What the UI does instead, and why it is not decoration:

- The `no-folders` state **names the five folders we looked in**. Someone whose transcripts sit in a
  differently-named folder would otherwise conclude the feature is broken, with nothing on screen to
  suggest otherwise.
- A successful listing carries a caption — *"Reading from your ⟨folders⟩ in Google Drive. Originals
  are never moved or changed."* — which is the **only place on screen that discloses the read
  happened at all**.

### 2a. Automatic discovery fires **once**; after that the rescan is explicit

Discovery re-runs **only while nothing is stored**, so an ordinary dashboard load never re-searches a
Drive we have already looked at, and two tabs racing it converge via `onConflictDoNothing` on
`(userId, driveFolderId)`. **Re-searching on every load was rejected**: it would be a standing cost
against a *personal* Drive, on the one route everybody opens, for an answer that changes about once
per person.

That asymmetry has a price, and it is why the rescan exists rather than being a nicety:
**`rescanTranscriptFolders` is the only thing standing between a newly-created folder and permanent
invisibility.** Automatic discovery can never pick up a *second* folder — someone whose Drive had
`Meet Recordings` and who later installs Tactiq has rows stored, so nothing re-searches, and the new
folder's transcripts simply never appear with nothing on screen to explain it. **Don't remove the
control without replacing it.**

Its shape follows from that:

- **Additive, never subtractive.** `rediscoverTranscriptFolders` inserts what it finds and removes
  nothing, so pressing it can only *widen* what you read — it can't silently drop a folder you were
  already reading from, which is what makes it safe to offer as a plain button.
- **Own-data-only by construction, hence no capability** — `emptyInputSchema` (no input at all), the
  caller's own Drive on the caller's own token, rows keyed on `ctx.user.id`. Same reasoning as
  `getDrivePickerToken`'s empty schema: **a `userId` parameter here would make it a search of someone
  else's personal Drive**, which is the one thing §1's bound cannot protect against.
- **Returns the same `TranscriptTriage` envelope**, so `reconnect` / `not-configured` / `no-folders`
  all render through the states that already exist. On success it returns `folderNames` with an
  **empty `transcripts`** array: this action decides *where* we read, not *what* was found, and the
  panel reloads its own listing rather than taking a second projection of the same payload from a
  second place.
- **Two entry points**, both in `TranscriptTriagePanel`: a **"Check again"** button inside the
  `no-folders` notice (the high-value case — no folder at first load, then a meeting recorded; without
  it someone has to guess that reloading eventually helps) and a **"Check for new folders"** link in
  the footer line that already names the folders being read (the case where a *second* folder
  appeared).

### 3. Filing requires the record's own edit capability — the second decision against the default

`assignTranscript` is gated by **`authorizeDriveFolder`, unchanged** from 0071 §7: it parses `kind`
off the raw `clientInput` and requires `crm.edit` for an opportunity or `projects.edit` for a
project. **No new capability, no matrix change** — the two are disjoint, which is why it is an
`authorize` hook rather than a static `metadata.permission`.

The consequence was named and accepted rather than discovered:

| Role | Sees own transcripts | Dismisses | Files to a deal | Files to a project |
|---|---|---|---|---|
| `user` (the consultant who sat in the meeting) | ✅ | ✅ | ❌ | ❌ |
| `sales` | ✅ | ✅ | ✅ | ❌ |
| `delivery-manager` | ✅ | ✅ | ❌ | ✅ |
| `manager` / `admin` | ✅ | ✅ | ✅ | ✅ |

So the person most likely to hold the transcript is often the one who cannot file it. That is
deliberate: filing **writes into the record's folder and may create the record's folder link**, which
is an edit to the record. The widget is still worth rendering for a plain `user` — dismissal is
theirs, and the list answers *"did that call get recorded?"*.

`getAssignableTranscriptKinds` resolves the offered kinds from **the same `DRIVE_FOLDER_TARGETS`
entries the gate reads**, so the UI can never offer a kind the action would refuse; a viewer holding
one capability sees only that segment, and one holding neither never sees the *File* button. A
hand-written `user.role === "sales"` check there is exactly the drift this avoids.

**Everything else carries no capability, and is own-data-only *by construction*:**
`getTranscriptTriage`, `searchTranscripts`, `getDismissedTranscripts`, `dismissTranscript` and
`rescanTranscriptFolders` are all keyed on `ctx.user.id` and none accepts a user id from the client (the `getMyTasks` shape, and the same reasoning
`getDrivePickerToken`'s empty input schema rests on). There is no ownership check to get wrong.

### 4. `searchTranscriptTargets` is ungated, and that **is** a disclosure

The assign dialog's type-ahead over filing targets carries **no capability**. Any signed-in user can
therefore enumerate:

- every **project** name — already broadly disclosed, since `/reporting/utilization` is open to
  everyone signed in ([ADR 0062](./0062-utilization-report-two-series-and-timesheet-disclosure.md)/[0064](./0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md)),
  so this adds nothing; and
- every **opportunity** name — which **nothing else in the app exposes outside `crm.edit`**.
  `getMyPipeline` shows a person only their own deals, and `getOrgPipeline` pre-folds counts per line
  of business *precisely* to keep deal rows off the wire
  ([ADR 0069](./0069-home-pipeline-closed-at-and-project-plan-deal-value.md)).

**Raised twice during planning and reaffirmed both times.** The asymmetry to hold: the *write* it
feeds is gated and the *read* is not, so the cohort that gains the disclosure (`user`) is precisely
the cohort that can do nothing with it. It is one search surface rather than two, so the whole
disclosure is a single auditable action rather than something to reassemble from two files.

**If it is ever revisited the fix is one line:** add `authorize: authorizeDriveFolder` to that
action's metadata — the hook already resolves the capability from the same `kind` the body switches
on, so gate and table cannot disagree. Documented in
[`domains/permissions.md`](../domains/permissions.md) → *An accepted disclosure*, which is the
canonical statement; don't duplicate it elsewhere. The neighbouring `searchProjects` is deliberately
**left alone** (company-scoped, gated on `projects.edit`, other callers depend on both).

### 5. Two tables — and why neither is the thing ADR 0071 rejected

`src/lib/db/drive-schema.ts`, `drizzle/0030_useful_northstar.sql`. **Both FK to `user`, not
`staff`**: the Drive grant lives on the Better Auth account and `getDriveAccessToken` takes a
`userId`, so the auth user is the identity that owns a Drive. There is no staff-side fact here, and
keying on `staff` would make someone's folders unreachable the moment their staff row was reshaped.

**`drive_transcript_folders`** — per-user discovered folder ids (`userId`, `driveFolderId`,
`folderName` snapshot), unique on `(userId, driveFolderId)`, indexed on `userId`.

> **This table is the read boundary, not a cache.** `driveListTranscriptDocs` takes its parents from
> here and nowhere else, so its rows are exactly the set of places we can see into. **It does not
> violate 0071 §4's "no cached Drive read":** §4's hazard is a *shared* cache entry serving one
> person's authorized listing to another, which is why every fetch is `no-store`. These are per-user
> rows filtered by `userId` on every read, so there is no cross-user path — and what is stored is not
> a listing but **which folders exist**, the *input* to a listing. Re-deriving it per widget load
> would mean a second uncacheable Drive round-trip for an answer that changes when someone makes a
> folder.

**`transcript_assignments`** — one triage decision, in exactly one of two shapes, enforced by the
CHECK `transcript_assignments_shape`:

- an **assignment** — exactly one of `opportunityId`/`projectId` (`num_nonnulls(...) = 1`) **plus**
  `copiedFileId`, so a row can never claim to have filed something without saying where the copy
  went;
- a **dismissal** — `dismissed`, no target, no copy.

Three unique indexes exploit **Postgres NULLS DISTINCT** so each constrains only its own kind:
`(userId, driveFileId, projectId)` ignores opportunity rows and dismissals (both null there) and vice
versa, plus a **partial** `(userId, driveFileId) WHERE dismissed` for dismissals. That combination is
what allows **multiple assignment rows per file** — a call about a deal that became a project
legitimately belongs to both, and the badges are the only place that history is visible — while still
refusing a duplicate against the *same* record. `fileName` and `fileCreatedAt` are snapshots, so the
archive still renders a transcript whose source has since been renamed, moved or deleted.

**ADR 0071 rejected "per-file records in our DB", and this is not that.** What it rejected was a
*mirror* of folder contents: a table shadowing what Drive holds, stale the moment someone uses Drive
directly, with Drive still the system of record. These rows record something Drive cannot tell us —
that a particular person decided a particular transcript belongs to a particular deal. **Nothing here
is derivable from Drive, so nothing here can go stale against it.** The sentence in 0071 reads as
though it forbids this table; it doesn't, and the distinction is the reason.

**Not seeded** (0071 §12's reasoning verbatim — a fake Drive id renders a link that errors inside
Drive while leaving the empty-state paths unexercised), but **both tables are listed in
`SEEDABLE_TABLES`** (`scripts/seed/wipe.ts`, before `tasks`, since they reference
`user`/`opportunities`/`projects`) so a reseed still starts from a clean state.

### 6. Filing: the step order is the design, again

`assignTranscript` mirrors `createRecordFolder`, because the same hazard applies — Drive is not
transactional with our DB:

1. **Read the record**, so a missing one fails before anything external happens.
2. **Refuse a duplicate** against the same record — readable error first; the unique indexes are the
   real defence, checked in the `catch` too.
3. **Verify the source sits in one of *this user's* stored transcript folders.** A **correctness**
   boundary, not a security one — `copyDriveFile` already copies any file the caller can read into
   any shared folder they can write to, so this refuses nothing they couldn't otherwise do. It keeps
   a row meaning what it says and stops a stale widget filing a doc that has since been moved out.
4. **No record folder yet → return `needs-folder` and touch nothing**, unless `confirmCreateFolder`.
   Creating a record's Drive folder is always something the person read and agreed to in the dialog,
   never a side effect of filing a file.
5. `resolveChildFolder("Transcripts", recordFolderId)` — find-or-create, so no record needs setting
   up in advance.
6. `files.copy` — the irreversible-ish call. **The copy's name comes from our own read of the
   source, never from the client.**
7. Insert the row. **If that fails, `driveDelete` the copy** — an *exact* compensation (the file is
   seconds old and we know its id), with `transcript_copy_orphaned` logged if even that fails. An
   uncompensated copy would put an untracked duplicate in a client folder that the widget would then
   offer to file again.

**Two extractions made this possible, both deliberate:** `createRecordFolder.ts` holds
`createDriveFolder`'s body **verbatim** (an action cannot call an action; both callers are gated),
and `copyFailure.ts` holds the shared `copyFailureError` — the failures are the *file's*, not the
flow's, so a `cannotCopyFile` needs the same words whichever button was pressed. `driveApi.ts` gained
the general `resolveChildFolder(name, parentId, token)`, which `resolveParentFolder` now delegates
to; both uses stay **inside the shared drive**.

`createdTime` was added to `driveFileWithParentsSchema` **and** `driveGetFile`'s field list **as a
pair** — Drive returns only the fields you name, so a projection narrower than its schema fails every
response as `invalid_response`, the drift trap 0071 already documented.

### 7. The widget loads on mount — `/` pays nothing for Google

0071 §11 kept both existing Drive surfaces free of a round-trip on their render path, and **`/` is
the worst place in the app to spend two uncacheable per-user Drive calls**: every signed-in person
loads it, and Drive reads can never be cached (§4). So `getTranscriptTriage` is a `'use server'`
action under the interactive-read exception, the panel fetches on mount, and the page pays only
`getAssignableTranscriptKinds` — session + matrix, **no query and no Drive call**.

Three behaviours that follow, each a decision:

- **The envelope gains a `no-folders` case**, extending `loadDriveFolderContents`' set
  (`ok`+`truncated` / `reconnect` / `no-access` / `not-configured` / `unavailable`). It earns its own
  state for 0071 §10's stated reason: an empty `ok` reads identically to *"you had no meetings"* for
  someone whose folder is named something we don't search for.
- **Search is server-side and covers all time**, unlike the in-memory task filter beside it. The
  difference is where the data lives: transcripts are in Drive and the panel holds **one window**, so
  filtering that window would make a search for an older meeting return nothing — indistinguishable
  from *"it doesn't exist"*. The caption says so.
- **The window is a ladder** (`TRIAGE_WINDOW_DAYS` = 7 / 30 / 90), validated server-side against the
  same tuple rather than accepting a number, because the window becomes a Drive query and an
  unbounded value invites *"ten years of a personal Drive in one call"*. Each rung re-queries, since
  the earlier window never held the older rows. Filtering is on **`createdTime`, not
  `modifiedTime`** — a transcript's date is when the meeting happened, so an edit two weeks later
  must not refloat it.

Dismissal touches **nothing in Drive**, which is what makes it safely reversible: the archive dialog
lists dismissals (from *our* snapshot, loaded on open) with one click to restore. A **filed**
transcript stays in the list, badged with where it went.

### 8. `googleDocUrl` — a narrow, structural exception to 0071 §10

0071 §10 warns against constructing a *file* URL and takes Drive's own `webViewLink`, because a
folder listing holds arbitrary mime types and each has its own URL shape. That caution doesn't bite
here, and the reason is structural rather than a judgement call: **every file this feature creates is
a copy of a Google Doc by construction** — `transcriptDocsQuery` filters sources to `GOOGLE_DOC_MIME`
and `files.copy` preserves the type — so the set of shapes is exactly one. The rejected alternative
was storing the copy's `webViewLink` in a column: a second snapshot to keep, for a URL derivable from
an id we already have.

⚠️ **The first draft used `driveFolderUrl` on a file id** — a real bug (a `/drive/folders/<id>` URL
for a document), caught and fixed. If a future kind of file is ever filed here, this exception dies
with the mime filter.

### 9. The payload is a disclosure boundary — the ADR 0063 §5 rule, third application

`TranscriptTriagePanel` is a Client Component, so `src/lib/home/transcripts.ts`'s `buildTranscriptViews`
is a pure fold that **copies field by field and spreads nothing** — the same shape as `buildOrgStatus`
and `MyTaskView`. Two things must never cross:

- **the transcript folder ids** — they *are* the read boundary (§1/§5), a browser has no use for
  them, and round-tripping them would invite a client-supplied scope;
- anything belonging to another user (already impossible by the `userId` filter; this is about not
  widening what a row carries).

`transcripts.test.ts` (20 tests, 9 of them on the day grouping) asserts on the **serialized** output rather than a field list, so a
future spread fails the test instead of quietly passing it. `recordName` is resolved live from our
own tables (we own that fact) while the *folder* name stays a snapshot (Drive owns that one) — 0071
§9's distinction, applied.

### 10. Where the code lives

- **`src/lib/drive/transcript.ts`** (+ `.test.ts`, 13 tests) — pure, client-importable, sibling of
  `folder.ts` under [ADR 0036](./0036-lib-organized-by-domain-subfolders.md) for the same reason (the
  feature spans CRM and Projects, so neither owns it): the five folder names,
  `TRANSCRIPTS_SUBFOLDER_NAME`, `GOOGLE_DOC_MIME`, the `TRIAGE_WINDOW_DAYS` ladder, **both query
  builders**, `transcriptWindowStart`, `googleDocUrl`, and `TRANSCRIPT_TARGET_LABELS` — keyed on
  `DriveFolderKind` rather than a parallel transcript enum, deliberately, so it cannot drift from the
  gate's own `DRIVE_FOLDER_TARGETS`.
- **`src/lib/home/transcripts.ts`** (+ `.test.ts`, 20 tests) — the pure payload fold (§9), plus
  `groupTranscriptsByDay`/`UNDATED_GROUP_KEY`: the list is grouped by **local calendar day** (UTC
  would file an evening call under the next day) inside a `ScrollList`, newest first, undated kept
  last, group **key** stable while the **label** is relative. Presentation, not a decision that
  reverses anything here — it's safe to compute client-side only because the panel fetches after
  mount (§7).
- **`src/actions/drive/`** — `transcriptFolders.ts` (server-only: `resolveTranscriptFolders` = the
  read boundary + silent discovery, `rediscoverTranscriptFolders`, `readAssignments`,
  `TRANSCRIPT_TARGET_COLUMN`) · `transcriptTriage.ts` (server-only: the `TranscriptTriage` envelope,
  `loadTranscriptViews`, `transcriptReadFailure` — **its own module because a `'use server'` file may
  export only async functions**, so a shared type or sync helper cannot live in an action) ·
  `getTranscriptTriage.ts` · `searchTranscripts.ts` · `rescanTranscriptFolders.ts` (§2a) ·
  `assignTranscript.ts` · `dismissTranscript.ts` ·
  `getDismissedTranscripts.ts` · `searchTranscriptTargets.ts` · `getAssignableTranscriptKinds.ts`
  (server-only read) · `transcript.schema.ts` (pure, client-imported —
  [ADR 0035](./0035-schema-modules-by-import-boundary.md)) · plus the two extractions
  `createRecordFolder.ts` and `copyFailure.ts`.
- **`src/components/home/`** — `transcript-triage-panel.tsx` · `transcript-row.tsx` ·
  `transcript-assign-dialog.tsx` · `transcript-archive-dialog.tsx`.
- **`src/lib/db/drive-schema.ts`** — the two tables, barrelled by `schema.ts`.

## Consequences

- **ADR 0071 §1's first guarantee no longer holds as written.** Anyone reading it must read this ADR
  too — 0071 carries a pointer at the top. The replacement bound is §1 above, and it is enforced by
  one private function plus two query templates. **Do not export `personalScopedList`.**
- **The amendment has no consent layer under it** (§2). Widening `TRANSCRIPT_FOLDER_NAMES`, or making
  either query builder take a caller-supplied clause, is a security change and not a tweak.
- **An ordinary `user` cannot file a transcript** (§3), and `sales`/`delivery-manager` can each file
  to only one of the two record kinds. Expect this to be reported as a bug; it isn't.
- **Every signed-in user can enumerate opportunity names** through `searchTranscriptTargets` (§4).
  Accepted, twice, and written down in `permissions.md`.
- **No capability, matrix or RBAC change.** `permissions.ts` and its test are untouched;
  `permissions.md` gained *narrative* only.
- **No new env var and no new OAuth scope** — the full `drive` scope 0071 already takes covers all of
  this, so [`guides/google-drive.md`](../guides/google-drive.md) is unchanged.
- **Still zero cache tags**, per 0071 §4. `drive_transcript_folders` is a read boundary, not a cache
  (§5), and no Drive response is stored anywhere.
- **A stray copy can survive** only if `files.copy` succeeds and both the insert *and* the
  compensating delete fail — `transcript_copy_orphaned` names it; there is no reconciliation job.
- **A new folder is picked up only by the explicit rescan** (§2a). Automatic discovery is a
  first-load-only event, so removing the "Check again" / "Check for new folders" controls would make
  a later folder invisible forever.
- **The dashboard is unchanged in cost:** `/` gained one session+matrix read and no Drive call (§7).
- **A dismissal or assignment row is per *source* file id.** If someone deletes and re-records a
  meeting, the new file is a new transcript — there is nothing to reconcile and nothing tries to.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| **Leaving ADR 0071 §1 intact** (no personal reads at all) | The feature is exactly "list transcripts in your Drive". The alternative was a Picker-per-transcript, i.e. the manual work this removes |
| **A general `driveList(scope)` parameter** | The one change that undoes 0071 §1 entirely. A second private function with a hardcoded corpora keeps the shared-drive path provably unwidened (§1) |
| **Exporting `personalScopedList`** | Becomes "ask this person's Drive anything". Private, with three fixed-shape callers, is the whole substitute guarantee (§1) |
| **`name contains` for folder discovery** | Laxer, but matches "Old Google Meet notes from Acme" and pulls unrelated documents into a client folder. Exact-match's blind spot (a renamed "Meet recordings") is stated in the UI instead — the better failure of the two (§1) |
| **Returning an empty `q` for an empty folder list** | Degrades to `mimeType = document` and lists **every Doc the person owns**. `null` + a type-forced caller check is the only version that can't regress (§1) |
| **A one-time "find my transcript folders" consent** | Offered and **declined** — silent discovery, with the code's bounds as the only protection and the folder names surfaced in the UI (§2) |
| **Re-running discovery on every widget load** | A standing search against a *personal* Drive, on the route everybody opens, for an answer that changes about once per person. An explicit additive rescan instead (§2a) |
| **A subtractive rescan** (reconciling stored rows against what Drive returns) | Pressing a button could then silently *stop* you reading a folder — e.g. one temporarily unshared or renamed. Additive can only widen (§2a) |
| **Returning the new listing from `rescanTranscriptFolders`** | A second projector of the same payload in a second place. It decides *where* we read; the panel reloads *what* was found (§2a) |
| **A `userId` on `rescanTranscriptFolders`** | Turns it into a search of someone else's personal Drive — the `getDrivePickerToken` mistake, in the one feature §1's bound can't cover (§2a) |
| **A new `transcripts.file` capability** | A third spelling of "may edit this record"; a matrix row would engage ADR 0014's lockstep for nothing (§3) |
| **Letting any signed-in user file a transcript** | Filing writes into the record's folder and can create its folder link. That is an edit to the record (§3) |
| **Gating `searchTranscriptTargets`** | Considered twice, declined twice; the fix is one line if revisited (§4) |
| **Two search actions, one per kind** | Splits one disclosure across two files, so an audit has to reassemble it (§4) |
| **Reusing `searchProjects`** | Company-scoped and gated on `projects.edit`; other callers depend on both properties (§4) |
| **FK to `staff` instead of `user`** | The Drive grant lives on the Better Auth account and the token accessor takes a `userId`; there is no staff-side fact here (§5) |
| **A polymorphic `targetId` + `targetKind` pair** | Loses the FK cascade and the typed target the shape CHECK relies on; `tasks`' concrete-FK shape again (§5) |
| **One assignment row per file** | A call about a deal that became a project belongs to both; the NULLS-DISTINCT indexes permit that while still refusing a duplicate per record (§5) |
| **Treating the folder table as a cache with a TTL** | It is the read boundary, not a cache; a TTL would mean re-searching a personal Drive on a timer (§5) |
| **Mirroring folder contents in our DB** | *That* is what ADR 0071 rejected: stale the moment someone uses Drive directly. Triage decisions aren't derivable from Drive at all (§5) |
| **Moving the transcript instead of copying** | Removes it from the person's own Drive; 0071 §1's third leg stands (§6) |
| **Creating the record's folder silently while filing** | A folder appearing as a side effect of a file copy. `needs-folder` makes it a decision the person saw (§6) |
| **Leaving the copy when the DB insert fails** | An untracked duplicate in a client folder that the widget would offer to file again (§6) |
| **A second find-or-create for `Transcripts`** | Would drift from `resolveParentFolder`; `resolveChildFolder` is the one general form, and both uses stay inside the shared drive (§6) |
| **Calling `createDriveFolder` from `assignTranscript`** | An action cannot call an action; the body moved to `createRecordFolder` verbatim, both callers gated (§6) |
| **Loading the triage list on `/`'s render path** | Two uncacheable per-user Drive calls on the one route everybody loads (§7) |
| **Collapsing `no-folders` into an empty `ok`** | Reads as "you had no meetings" to the person whose folder we never looked in (§7) |
| **Filtering the loaded window client-side for search** | A search for an older meeting returns nothing, which looks exactly like "it doesn't exist" (§7) |
| **A free-form "days back" number** | The window becomes a Drive query; the ladder bounds it and keeps client and UI agreeing on which windows exist (§7) |
| **Ordering/filtering on `modifiedTime`** | An edit two weeks after the call would refloat the transcript to the top of triage (§7) |
| **Storing the copy's `webViewLink`** | A second snapshot to maintain for a URL derivable from the id; every copy is a Doc by construction (§8) |
| **`driveFolderUrl` on the copied file id** | The first draft did exactly this and produced a broken folder-shaped URL for a document — a real bug (§8) |
| **Shipping the folder ids to the client** | They are the read boundary; a client-supplied scope is the thing §1 exists to prevent (§9) |
| **A parallel transcript-target enum** | One drifting entry means a kind the UI offers and the gate can't resolve — or resolves to the wrong table (§10) |
| **Seeding fixture transcripts** | 0071 §12: a fake Drive id renders a link that errors inside Drive, leaving the interesting paths unexercised (§5) |
