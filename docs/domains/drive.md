# Domain: Google Drive folders

**Status: built (two slices).** (1) Two kinds of Drive folder are linked to PSA records — a **sales
folder** on an opportunity and a **project folder** on a project — with create / link / unlink, plus a
**Files** tab on each surface that browses the folder and adds files to it. (2) **Meeting-transcript
triage** — a widget on the home dashboard listing the Meet/Tactiq transcripts in the signed-in
person's *own* Drive, with one click to file a copy into the record it belongs to. Nothing else about
Drive exists: no rename/delete/move of files, no permission management, no mirror of folder contents
in our DB.

This is not a sixth business domain; it's a **cross-domain integration** that CRM and Projects each own
half of — the same shape as [slack.md](./slack.md), and deliberately modelled on it. It gets its own doc
because neither [crm.md](./crm.md) nor [projects.md](./projects.md) owns the shared machinery, which is
the same reason `src/lib/drive/` exists at all
([ADR 0036](../decisions/0036-lib-organized-by-domain-subfolders.md)). Full rationale:
[ADR 0071](../decisions/0071-google-drive-folder-links-per-user-oauth-and-the-privacy-invariant.md)
for the folder links and everything shared, and
[ADR 0072](../decisions/0072-transcript-triage-and-bounded-personal-drive-reads.md) for transcript
triage — **which amends 0071 §1**. Setup procedure:
[`guides/google-drive.md`](../guides/google-drive.md) (unchanged by the second slice: no new env var,
no new scope).

## The privacy invariant — read this first

Drive is a filesystem people keep personal things in, so **the defining design of this feature is what
it structurally cannot do.** Three guarantees, enforced by the shape of the code rather than by policy:

1. **The shared-drive listing can't be widened.** Every shared-drive listing goes through `driveList()`
   (`src/actions/drive/driveApi.ts`), which **hardcodes** `corpora=drive` +
   `driveId=env.GOOGLE_DRIVE_ROOT_ID`. **Scope is not a parameter**, so no call site can widen it —
   not by accident, and not by someone later adding "an optional `driveId`". Widening that signature
   undoes the whole design; that is the review tripwire.
   ⚠️ **This used to read "we never enumerate anyone's personal Drive", and transcript triage spent
   that** ([ADR 0072](../decisions/0072-transcript-triage-and-bounded-personal-drive-reads.md)). See
   *[Transcript triage](#meeting-transcript-triage)* below for the bound that replaces it: `driveList`
   is untouched, and personal reads go through **one private, never-exported function whose three
   callers each build `q` from a fixed template**, so the *query shape* is no more a parameter than
   the scope is.
2. **Only two paths touch a file outside the shared drive:** `copyDriveFile`, whose `fileId` always
   comes from a **Google Picker** selection (the user's own click, in Google's UI), and transcript
   triage's bounded listing + copy.
3. **It copies, never moves.** Nothing anywhere rewrites a file's `parents`, so pulling a file into a
   project folder — or filing a transcript — can't quietly remove it from someone's own Drive.

Plus two server-side confinements: `linkDriveFolder` and `copyDriveFile` each read the target's
metadata and **refuse anything whose `driveId` isn't `GOOGLE_DRIVE_ROOT_ID`**.

**The one concession:** authorizing the Picker requires `setOAuthToken`, so a full-Drive access token
reaches the browser. That is inherent to the Picker and is the accepted price of not building an
uploader. It is bounded by being the signed-in person's own token, short-lived, and **fetched per
Picker open rather than held**.

## The two kinds

| Kind | Folder | Stored on | Managed at | Capability |
|---|---|---|---|---|
| `sales` | `Lazer Home/Sales/<opportunity name>` | `opportunities.salesDriveFolderId` + `…Name` | the opportunity detail drawer (Details tab rail + Files tab) | `crm.edit` |
| `project` | `Lazer Home/Projects/<project name>` | `projects.driveFolderId` + `…Name` | `/projects/[id]` (sidebar + Files tab) | `projects.edit` |

The folder name is **the record's own name, verbatim** — `buildDriveFolderName` only collapses
whitespace and caps at 255 characters. Simpler than the Slack equivalent in two ways: Drive has no slug
rules (so nothing to slugify and no prefix to strip back off for matching), and a folder URL needs no
configuration (so `toDriveFolderRef` lives in the **pure, client-importable** module rather than being
server-only like `toSlackChannelRef`). Note `/` is deliberately **left alone**: it's legal in a Drive
name, so stripping it would corrupt "Discovery / Scoping" for no gain.

`Sales` and `Projects` are resolved by name at the drive root and **created on first use**, so a fresh
shared drive needs no manual setup. `resolveParentFolder` takes the **oldest** match by `createdTime`,
so a concurrent double-create (Drive permits duplicate names) converges rather than forking.

**Each record manages only the folder that lives on it.** The opportunity drawer does not reach across
to the linked project's folder, and **creating a project does not carry the sales folder over** — many
opportunities can feed one project, so there'd be no unambiguous owner. Same call as
[ADR 0067 §2](../decisions/0067-slack-channel-links-bot-token-denormalized-pairs-and-record-scoped-gate.md)
made for the Slack channels.

## Per-user OAuth — the repo's first

**Every Drive call is made as the signed-in person, on their own token.** No service account, and no
"connect Drive" flow: everyone already signs in with Google, so the existing grant was widened
(`src/lib/auth/auth.ts`).

```ts
google: { …, scope: [DRIVE_SCOPE], accessType: "offline", prompt: "select_account consent" },
account: { encryptOAuthTokens: true },
```

This is the **opposite** call to Slack's one bot token, and it's worth the machinery here because it
buys three things a bot could not: **Google enforces shared-drive membership for us**, **Drive's audit
trail names the real human**, and **a personal file can be copied in at all** (a bot has no access to
anyone's own Drive).

- `accessType: "offline"` and `prompt: "…consent"` are **load-bearing**. Google issues a refresh token
  only on an explicit consent with offline access; drop either and Drive works for one hour per login.
- **`encryptOAuthTokens` was switched on in the same change** because the `account` table now holds
  refresh tokens granting standing full-Drive access to every employee. Keyed on
  `BETTER_AUTH_SECRET`. **Consequence: a Drizzle read of `account.accessToken` returns ciphertext.**
- **No `bun run auth:generate` was needed** — `account` already had `refreshToken`,
  `accessTokenExpiresAt` and `scope`.

### `driveToken.ts` and its three traps

All token access goes through **`auth.api.getAccessToken`** (it decrypts *and* refreshes), never a
Drizzle read. `src/actions/drive/driveToken.ts` exists to close three failures that are otherwise
silent:

| Trap | Why it bites |
|---|---|
| **No refresh token** | Better Auth returns the **stale** access token with no error, which surfaces as an opaque 401 from Drive several calls later. So expiry is re-checked here (30s skew) and a still-expired token means "reconnect". |
| **An old grant with no Drive scope** | A valid token that can't touch Drive. Checked against `DRIVE_SCOPE` and collapsed into the **same** user-visible state as expiry, because it's the same instruction. |
| **`scope` is comma-joined** | Better Auth stores it comma-joined, not space-joined as OAuth does. Use the endpoint's already-split `scopes`; re-splitting on spaces makes every check silently fail. |

Two shapes for two callers: `getDriveAccessToken` → `null` (a read renders a "reconnect" panel);
`requireDriveAccessToken` → throws *"Reconnect your Google account to use Drive."*, the same words the
reconnect button carries.

### The migration cost, and reconnecting

**Changing the provider config grants nothing retroactively.** Everyone who signed in before it must
sign out and back in once — or press **Reconnect Google Drive**, which calls
`authClient.linkSocial({ provider: "google", scopes: [DRIVE_SCOPE] })`. That's the documented
incremental-consent path, and Better Auth's Google provider sends `include_granted_scopes`, so it
**adds** Drive to the existing grant rather than replacing it. Crucially **it is not a sign-out** — the
session survives. It's also the recovery path when someone revokes the app in Google settings.

### Why the full `drive` scope

`drive.file` (per-file access) would make a folder listing **structurally incomplete**: a file a
colleague added through Drive's own UI would be invisible to us, so the Files tab would show a subset of
the folder and imply that was all of it. The full scope is *restricted* in Google's classification and
is usable **without verification or a CASA assessment only because the OAuth consent screen is
Internal** — a setup constraint, stated in the [guide](../guides/google-drive.md).

## Nothing is cached, and that's a security decision

**This feature adds zero cache tags**, the exact opposite of
[ADR 0067 §7](../decisions/0067-slack-channel-links-bot-token-denormalized-pairs-and-record-scoped-gate.md)
which introduced the repo's first two. Every Drive request sets `cache: "no-store"`.

Slack's reads cache safely *because* one bot token makes the response identical for everyone. Drive
calls carry a **per-user** token, so a shared cache entry is **one person's authorized listing served
to another** — a cross-user disclosure in the one feature whose entire point is that Google decides who
sees what. Two follow-ons: `resolveParentFolder` re-resolves `Sales`/`Projects` on every create rather
than caching ids, and the token is fetched per request. **Do not "optimise" any of this.**

## Authorization — no capability was added

The gate on the three **link** actions **and on `assignTranscript`** is an **`ActionAuthorize` hook**,
`authorizeDriveFolder`: it parses `kind` off the raw `clientInput` and requires the capability
belonging to **the record being written** — `crm.edit` for `sales`, `projects.edit` for `project`.

**Why a hook rather than `metadata.permission`:** those two capabilities are **disjoint** in the matrix
(`sales` holds only `crm.edit`, `delivery-manager` only `projects.edit`), so any single static
capability would either lock out one audience or grant one of them the other domain. Because the hook
reuses existing capabilities, **`permissions.ts`, `permissions.test.ts` and
[permissions.md](./permissions.md)'s matrix are all untouched** — ADR 0014's lockstep rule is not
engaged, and it should stay that way. A `drive.manage` capability would be a third spelling of "may edit
this record".

Two things keep it a real gate:

- **An unparseable `kind` is denied, not skipped.** A hook that bails out when it can't read its own
  discriminant leaves the body running ungated.
- **`DRIVE_FOLDER_TARGETS` (`src/actions/drive/driveFolderLink.ts`) is the only place a kind maps to a
  table, a column pair, a capability and a revalidation.** The hook and every action body read the same
  entry, so "the hook checked `crm.edit` but the body wrote a `projects` column" is unrepresentable.

### The four ungated actions, and why that's correct

`searchDriveFolders`, `loadDriveFolderContents`, `copyDriveFile` and `getDrivePickerToken` carry **no
capability**, deliberately. They run on **the viewer's own Google token**, and `driveList` confines
every query to the shared drive, so they can only surface or write what that person could already see
and do in Drive's own UI — Google enforces shared-drive membership. A gate there would be **theatre**:
it would refuse in our UI what the same person can do in Drive in two clicks, while protecting nothing.

Two consequences to hold:

- **Sales-folder files are still `crm.edit`-only in practice**, because the opportunity Sheet is only
  mounted from the board and table for `crm.edit` holders. That's a **property of the surface, not a
  second gate** — don't rely on it if the drawer ever opens to non-editors.
- `loadDriveFolderContents` accepts **any** folder id inside the shared drive, not only a linked one,
  so the panel can navigate subfolders. Safe on exactly the reasoning above.

**`getDrivePickerToken` is the security boundary in this feature.** It takes `z.object({})` — no input
at all — and returns `ctx.user`'s token (plus the two public Picker credentials, returned from here so
a half-configured install fails in one place). **A `userId` parameter there would hand one person a
token for another person's entire Drive.** If a change ever seems to need it, that's not a refactor —
stop and flag it.

### The triage actions' gates

Same axis, two additions worth stating (ADR 0072 §3–§4):

- **`assignTranscript` is the *only* gated triage action** — `authorizeDriveFolder`, unchanged. So an
  ordinary `user` can list and dismiss their own transcripts but **cannot file any of them**, `sales`
  can file to a deal but not to the project it became, and `delivery-manager` the reverse. Deliberate,
  not a gap. `getAssignableTranscriptKinds` resolves the offered kinds from the **same**
  `DRIVE_FOLDER_TARGETS` entries, so the UI can never offer a kind the action would refuse.
- **Everything else is own-data-only *by construction***: `getTranscriptTriage`, `searchTranscripts`,
  `getDismissedTranscripts`, `dismissTranscript` and `rescanTranscriptFolders` are keyed on
  `ctx.user.id` and none accepts a user id from the client (the `getMyTasks` shape). There is no
  ownership check to get wrong — and **adding a `userId` parameter to any of them is the
  `getDrivePickerToken` mistake again**, since three of them read a personal Drive.
- ⚠️ **`searchTranscriptTargets` is deliberately ungated and *is* a disclosure** — every project *and
  every opportunity* name, by type-ahead, to every signed-in user including those who can file
  nothing. Nothing else in the app exposes the deal list outside `crm.edit`. Raised twice and
  reaffirmed; the canonical write-up is
  [permissions.md → *An accepted disclosure*](./permissions.md), and the fix if it's ever revisited is
  one line (`authorize: authorizeDriveFolder`).

## What each action does

The seven folder-link actions live in `src/actions/drive/` alongside the triage ones (below).

- **`createDriveFolder`** — creates the folder in Drive and links it. **The step order is the design**,
  because the create isn't transactional with our write: reject-if-linked (and reject a blank record
  name) → resolve/create the `Sales`/`Projects` parent → **name-collision precheck** under it, refusing
  with *"link it instead of creating another"* rather than making a duplicate → `files.create` → persist
  under an `isNull` guard → **on persist failure, `files.delete`** as the compensating action, plus a
  `drive_folder_orphaned` error log if even that fails. **This is where Drive beats Slack:** Slack has
  no `conversations.delete`, so an orphan could only be archived; here the folder is empty and seconds
  old, so the recovery is exact. The **stored name is the one Drive returns**.
- **`linkDriveFolder`** — points a record at an existing folder. Takes the folder **id only**; the name
  is read back from Drive server-side, so a client can't make the displayed name disagree with the
  folder. **Never touches the folder** (no rename, no move, no permission change). **Requires no naming
  convention** — adopting folders that predate it is much of the point; creating is what enforces the
  naming. The two checks it does make: the id must resolve to a **folder** (not a file) that lives in
  the **shared drive**, and it must not already belong to another record.
- **`unlinkDriveFolder`** — clears the two columns and **nothing else**; the folder and its files are
  untouched, which is what the confirmation copy promises. In scope from day one because it's the only
  escape hatch for the ways a link goes bad: wrong folder linked, folder deleted or moved out of the
  shared drive, folder renamed past recognition.
- **`searchDriveFolders`** — type-ahead over folders in the shared drive, `SearchAction`-shaped for
  `EntityCombobox`. Blank query returns nothing; already-linked folders are filtered out (spanning both
  kinds); returns `[]` rather than throwing on any failure, since this feeds a combobox where "no
  matches" is normal. Deliberately **not** restricted to `Sales`/`Projects` — see `linkDriveFolder`.
- **`loadDriveFolderContents`** — the Files tab's listing. Returns a **status envelope**, never throws
  (see below).
- **`copyDriveFile`** — `POST /files/{id}/copy` with `{ parents: [folderId] }`. The privacy invariant's
  third leg. Resolves the **destination first** (that's what confines copies to the shared drive), then
  reads the source's name server-side so the copy can't be given a misrepresenting name. Refuses a
  folder as a source.
- **`getDrivePickerToken`** — see above.

## The status envelope, and the one-page listing

`loadDriveFolderContents` returns a tagged union rather than throwing — the `getSlackChannels` rule (a
read on a render path must never throw), and here every failure is an **ordinary** state with a
different person who can fix it:

| Status | Means | Rendered as |
|---|---|---|
| `ok` (+ `truncated`) | the entries | the table |
| `reconnect` | no Drive scope, or refresh failed | an `InlineNotice` **with the reconnect button inline** |
| `no-access` | 403/404 — not a member of Lazer Home, or the folder was deleted in Drive | an `InlineNotice` naming both possibilities |
| `not-configured` | env vars unset | an `EmptyState` |
| `unavailable` | timeout, 5xx, rate limit | an `InlineNotice` ("try again in a moment") |

Collapsing these into one "couldn't load files" would make every one of them look like our bug.

**`driveList` fetches ONE page (`pageSize=1000`, Drive's max) and does not follow `nextPageToken`.** So
callers compare their result length against `DRIVE_LIST_PAGE_SIZE` and the envelope carries
`truncated`, which the panel surfaces as *"this folder holds more files than we can list here"*. Same
honesty as `getSlackChannels`'s `degraded`: **a partial listing rendered as complete is how someone
concludes a file isn't there when it is.**

## Adding files — the Picker, in two modes

`use-google-picker.ts` loads `apis.google.com/js/api.js` **once per page** (a module-level promise, so a
second Files tab reuses the in-flight load rather than injecting a second script tag), then builds a
Picker with **exactly one view**:

| Mode | View | What happens after |
|---|---|---|
| **Upload** | `DocsUploadView().setParent(folderId)` | **Nothing** — Google's uploader wrote straight into the folder. Just refresh the listing. |
| **From my Drive** | `DocsView` over what the user can already see | The ids come back and the panel calls `copyDriveFile` for each. |

**Why two single-view Pickers rather than one with both views** (a deliberate deviation from the
implementation plan): a combined Picker returns **one undifferentiated `PICKED` list**, so the callback
would have to *infer* which documents Google already wrote into the folder and which still need
copying. Inferring wrong in the safe direction costs an extra API call; inferring wrong in the other
direction **silently creates a duplicate file**. **The mode, not the payload, decides.** The cost is one
extra button, which also names the two intents better than "Add files" did.

Two client details worth keeping:

- **After an upload, the listing must be re-fetched or the file appears not to exist.** Google wrote it
  without telling our server; nothing else will refresh the list.
- **Copies are awaited one at a time** (`executeAsync` in a loop), not fired in parallel. `useAction`
  keeps a **single** slot of result state, so N synchronous `execute` calls supersede one another — the
  hook would report only the last, each completion would fire its own toast and its own refresh, and a
  20-file selection would open 20 parallel Drive copies. The partial outcome is reported honestly
  ("3 files added" *plus* the first error), because with a multi-file selection some genuinely can
  succeed while others fail.

## Meeting-transcript triage

**The second slice, and the one that changed the privacy invariant.** Rationale and every rejected
alternative: [ADR 0072](../decisions/0072-transcript-triage-and-bounded-personal-drive-reads.md).

The **Triage** widget sits on the home dashboard (`/`, inside *Your Status*, after the task list). It
lists the Google Meet / Tactiq transcripts in the signed-in person's **own** Drive; one click files a
**copy** into the opportunity or project it belongs to, under `<record folder>/Transcripts`
(find-or-created, so no record needs setting up in advance).

### The bound that replaced "we never enumerate a personal Drive"

`driveList` is untouched. Beside it sits **`personalScopedList`** — the only function in the repo that
leaves the shared drive. It hardcodes `corpora: "user"` and is **private, not exported**, so a
free-form `q` against someone's own Drive is unreachable from outside `driveApi.ts`. Its three callers
each build `q` from a fixed template in `src/lib/drive/transcript.ts`:

| Caller | Query | Takes |
|---|---|---|
| `driveFindTranscriptFolders` | `transcriptFolderQuery()` — folders named one of five exact names | **nothing at all** |
| `driveListTranscriptDocs` | `transcriptDocsQuery(folderIds, { sinceIso })` | stored folder ids + a date |
| `driveSearchTranscriptDocs` | `transcriptDocsQuery(folderIds, { nameContains })` | stored folder ids + a substring |

**Total surface:** whether you own a folder called `Google Meet`, `Meet Recordings`,
`Legacy Meet Recordings`, `Tactiq Transcription` or `Tactiq Transcriptions`, plus the **titles and
creation dates** of the Google Docs directly inside them. Never anything else you own, never file
contents.

Three tripwires:

1. **Don't export `personalScopedList`**, don't give any of the three callers a `q`/`names` parameter,
   and don't make `TRANSCRIPT_FOLDER_NAMES` configurable. Any of those turns a bounded read back into
   general enumeration.
2. ⚠️ **`transcriptDocsQuery` returns `null` for an empty folder list, and every caller must honour
   it.** An empty `parents` clause either collapses to `()` (Drive rejects it) or vanishes — leaving
   `mimeType = document`, which lists **every Google Doc the person owns**. `transcript.test.ts` pins
   this as its most important assertion.
3. **The query builders live in the pure module, not inline in the transport**, so the bounds are
   testable. The bounds *are* the security property.

`name =` is case- and whitespace-exact in Drive, so a folder renamed to "Meet recordings" is invisible
to us. That incompleteness is **stated in the UI, not worked around** — `name contains` would also
match "Old Google Meet notes from Acme" and pull unrelated documents into a client folder.

### Discovery is silent — a decision, not an omission

The first widget load searches for the five names and stores what it finds, **without asking**. A
one-time confirm was offered and declined, so **the amendment rests on the code's bounds alone with no
consent action underneath it**. The UI compensates in two places, and neither is decoration: the
`no-folders` state **names the five folders searched**, and a successful listing carries *"Reading
from your ⟨folders⟩ in Google Drive. Originals are never moved or changed."*

### Discovery runs once; the rescan is explicit

Discovery re-runs only **while nothing is stored**, so an ordinary page load never re-searches a Drive
we've already looked at; concurrent tabs converge via `onConflictDoNothing`. Re-searching every load
was rejected — a standing cost against a *personal* Drive, on the route everybody opens, for an answer
that changes about once per person.

⚠️ **The consequence is that `rescanTranscriptFolders` is the only thing between a newly-created
folder and permanent invisibility.** Automatic discovery can never find a *second* folder: someone
whose Drive had `Meet Recordings` and who later installs Tactiq already has rows stored, so nothing
re-searches. **Don't remove the control without replacing it.**

- **Additive, never subtractive** — it inserts what it finds and removes nothing, so pressing it can
  only widen what you read, never silently drop a folder you were already reading from. That's what
  makes it safe as a plain button.
- **Own-data-only by construction, so no capability**: `emptyInputSchema` (no input at all), the
  caller's own Drive on their own token, rows keyed on `ctx.user.id`. **A `userId` parameter here
  would make it a search of someone else's personal Drive** — the `getDrivePickerToken` rule again.
- **Returns the same envelope**, so `reconnect` / `not-configured` / `no-folders` reuse the existing
  states. On success `transcripts` is **empty** and only `folderNames` is populated: the action decides
  *where* we read, and the panel reloads its own listing rather than taking a second projection from a
  second place.
- **Two entry points:** a **"Check again"** button inside the `no-folders` notice (no folder at first
  load, then a meeting recorded) and a **"Check for new folders"** link in the footer line that names
  the folders being read (a second folder appeared later).

### Filing — step order is the design

`assignTranscript`, mirroring `createRecordFolder` because Drive still isn't transactional with our DB:

read the record → **refuse a duplicate** against that record → **verify the source sits in one of this
user's stored folders** (a *correctness* boundary, not a security one — `copyDriveFile` already copies
any file the caller can read) → **return `needs-folder` and touch nothing** unless the person confirmed
creating the record's folder → `resolveChildFolder("Transcripts", …)` → `files.copy` (name taken from
**our** read of the source, never the client) → insert the row → **if the insert fails, `driveDelete`
the copy** (exact compensation; `transcript_copy_orphaned` if even that fails).

It **copies, never moves**. Two supporting extractions: `createRecordFolder.ts` holds
`createDriveFolder`'s body **verbatim** (an action can't call an action; both callers gated) and
`copyFailure.ts` the shared `copyFailureError`. `driveApi.ts` gained the general
`resolveChildFolder(name, parentId, token)`, which `resolveParentFolder` now delegates to — both uses
stay **inside the shared drive**.

### Reads, states and the widget

- **The widget loads on mount, not on `/`'s render path.** Every signed-in person loads `/` and Drive
  reads can never be cached, so the page pays only `getAssignableTranscriptKinds` (session + matrix,
  **no query, no Drive call**) and the panel fetches its own contents — the `DriveFilesPanel` idiom.
- **The status envelope adds `no-folders`** to `loadDriveFolderContents`' set. It earns its own state:
  an empty `ok` reads identically to *"you had no meetings"* for someone whose folder is named
  something we don't search for.
- **Search is server-side and covers all time**, unlike the in-memory task filter beside it —
  transcripts live in Drive and the panel holds one window, so filtering that window would make a
  search for an older meeting return nothing, indistinguishable from "it doesn't exist".
- **The window is a ladder** (7 / 30 / 90 days), validated server-side against the same tuple; each
  rung re-queries, because the earlier window never held the older rows. Filtering is on
  **`createdTime`, not `modifiedTime`** — a transcript's date is when the meeting happened.
- **The list is grouped by day and height-capped**, not truncated: `groupTranscriptsByDay` (pure,
  beside the fold) buckets by **local calendar day** — UTC would file a 5pm Pacific call under the
  next day — newest day first, with **undated transcripts kept last** rather than dropped (the same
  honesty as `truncated`). The group **key is a stable `YYYY-MM-DD`, the label relative**, so a group
  can't be reused against the wrong day at midnight; rows show the **time of day only**, since the
  header carries the date. Safe to group client-side precisely because the panel fetches after mount.
- **Dismissal touches nothing in Drive**, which is what makes it reversible: the archive dialog lists
  dismissals from *our* snapshot (loaded on open) with one click to restore. A **filed** transcript
  stays in the list, badged with where it went, because one call can belong to both a deal and the
  project it became.
- **`googleDocUrl` is a deliberate, narrow exception to the "never construct a file URL" rule**: every
  file this feature creates is a copy of a Google Doc by construction (mime filter + `files.copy`
  preserving type), so there is exactly one URL shape. ⚠️ The first draft used `driveFolderUrl` on a
  file id — a real bug, caught and fixed.
- **The payload is a whitelist** ([ADR 0063](../decisions/0063-home-dashboard-two-time-bases-and-point-in-time-staffing.md) §5):
  `src/lib/home/transcripts.ts`'s `buildTranscriptViews` copies field by field and spreads nothing, and
  the **transcript folder ids are withheld** because they are the read boundary. Its tests assert on
  the *serialized* output so a future spread fails.

### The two tables

`src/lib/db/drive-schema.ts`, `drizzle/0030_useful_northstar.sql`. **Both FK to `user`, not `staff`** —
the Drive grant lives on the Better Auth account and the token accessor takes a `userId`.

- **`drive_transcript_folders`** — per-user discovered folder ids + a name snapshot; unique on
  `(userId, driveFolderId)`, indexed on `userId`. **This table is the read boundary, not a cache:**
  `driveListTranscriptDocs` takes its parents from here and nowhere else, so its rows are exactly the
  set of places we can see into. It does **not** contradict "nothing is cached" above — that hazard is
  a *shared* cache entry serving one person's listing to another, and these rows are per-user, filtered
  by `userId` on every read, storing *which folders exist* rather than a listing.
- **`transcript_assignments`** — one triage decision, in exactly one of two shapes under the CHECK
  `transcript_assignments_shape`: an **assignment** (exactly one of `opportunityId`/`projectId` **plus**
  `copiedFileId`) or a **dismissal** (neither, no copy). Three unique indexes exploit **Postgres NULLS
  DISTINCT** so each constrains only its own kind — `(userId, driveFileId, projectId)`,
  `(userId, driveFileId, opportunityId)`, and a **partial** `(userId, driveFileId) WHERE dismissed`.
  That's what allows **several assignment rows per file** while still refusing a duplicate against the
  same record. `fileName`/`fileCreatedAt` are snapshots, so the archive still renders a transcript
  whose source has been renamed or deleted.

**This is not the "per-file records in our DB" that ADR 0071 rejected.** That rejected a *mirror* of
folder contents — stale the moment someone uses Drive directly. These rows record who filed what
where, which Drive cannot tell us and which therefore cannot go stale against it.

## Storage

Two nullable `text` columns per owning table (`drizzle/0029_tense_jocasta.sql` — 4 `ADD COLUMN`, 2
unique indexes, 2 checks, **no backfill**), plus:

- a **named `uniqueIndex`** per table (`opportunities_sales_drive_folder_idx`,
  `projects_drive_folder_idx`) — one folder, at most one record of that kind. Plain, not partial:
  Postgres treats NULLs as distinct, so the unlinked majority is unconstrained. Named so
  `isUniqueViolation` can key off it (the third layer of the double-click defence, after the pre-read
  and the `isNull` guard on the update);
- a **`check`** per table (`…_drive_folder_shape`) enforcing **both null or both set**, so a
  half-written link is unrepresentable.

**No `drive_folder_links` table**, deliberately — both relationships are 1:1, and a polymorphic table
needs an untyped `recordId` with no FK (losing the cascade that drops the link when the deal or project
is deleted) plus a join on every detail read.

**Cross-kind uniqueness is a UX rule, not a DB invariant.** The same folder as both a sales folder *and*
a project folder is prevented in `linkDriveFolder` and hidden from search by `folderIdsAlreadyLinked`
(two indexed `IN` lookups over a **candidate shortlist**, so it doesn't grow with the number of
records).

**The stored name is a display snapshot.** Every link is by **id**, so a rename in Drive never breaks
the hyperlink; it only makes the label stale. Nothing writes the name back from a read — that would turn
every detail render into a Drive call, and an uncacheable per-user one at that. The create dialog says
so inline: *"Renaming the record later will not rename the folder."*

## Feature flag

`isDriveConfigured()` requires **all three** of `GOOGLE_DRIVE_ROOT_ID`,
`NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` and `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID`. Browsing needs only the
first, but the Picker needs its own two, and **a half-configured install where files list yet nothing
can be added is worse than a feature that's plainly off.**

It's a cheap synchronous env read, passed to the UI as `driveEnabled` — on the opportunity drawer's
**envelope** (`OpportunityDrawerData`, beside `slackEnabled`) because it describes the *environment*,
not the opportunity, and as a prop to `ProjectDetailView`. **Neither surface gained a Drive
round-trip:** the stored link comes off the row already being read, and the **Files tab lazy-loads its
own contents on open**, so one component serves both surfaces and nobody pays for Drive unless they
look.

`DriveFolderField` resolves the same **five** cases as `SlackChannelField`, on the same axis — not
whether the integration is configured, but **whether this viewer could act on it**:

| # | Folder | Configured | `canManage` | Renders |
|---|---|---|---|---|
| 1 | linked | either | either | the folder link (unlink offered with `canManage`) |
| 2 | — | yes | yes | "Create or link" |
| 3 | — | yes | no | muted "Not linked" |
| 4 | — | **no** | **yes** | "Create or link" **+ a muted "Google Drive isn't connected"** |
| 5 | — | no | no | **nothing — the row is hidden** |

i.e. `if (!enabled && !folder && !canManage) return null`, with case 4 reachable *only* because of that
early return — read the guard and the case-4 branch together. The reasoning is
[ADR 0067 §10](../decisions/0067-slack-channel-links-bot-token-denormalized-pairs-and-record-scoped-gate.md)'s
(amended) verbatim: a reachable control plus a reason teaches more than an absent one, or the person
whose job it is to connect Drive is the one certain never to learn the slot exists. **Case 4 is
deliberately live, not disabled-with-a-tooltip** — the fix is an env var an admin sets, not anything
actionable there. **Case 1 is unconditional:** the folder URL is just a URL, so dropping it because an
env var went missing would lose information for nothing, and **unlink still works** (app-side only).

## Transport

`driveApi.ts` is a handful of functions, not an SDK — the
[ADR 0029](../decisions/0029-external-fx-rates-and-currency-normalization.md) pattern (bare `fetch`,
Zod at the trust boundary, no vendor client; **do not add `googleapis`**), extended here to the first
**per-user-credentialed** service. Three Drive-specific traps it exists to close:

- **No caching, ever** — see above. Every request is `no-store`.
- **`supportsAllDrives=true` is not optional.** Omit it and shared-drive operations fail in ways that
  read as permission errors, sending you hunting for the wrong bug.
- **Scope is not a parameter** (`driveList`) — the structural half of the privacy invariant.

Unlike Slack, Drive uses real status codes, so `res.ok` is meaningful. `DriveApiError` still carries
Drive's own `error.errors[].reason` alongside the status, because 403 covers both "you can't write to
this shared drive" and "the owner blocked copying", which need different copy. Every call carries a 10s
`AbortSignal.timeout`. Each action maps only the handful of codes it has real copy for
(`insufficientFilePermissions`, `notFound` → logged as `drive_root_not_found`, a **setup** bug not a
user error, `cannotCopyFile`, `storageQuotaExceeded`, `rateLimitExceeded`, 401 → reconnect).

**`driveQuoteValue` is not cosmetic.** Drive's query language delimits literals with single quotes and
escapes `\` and `'` with a backslash. Get it wrong on a folder named "Sam's deal" and the query fails to
parse — which means the "does this folder already exist" precheck **errors out and the create path makes
a duplicate instead of refusing.** Every caller building a `q` with user-controlled text must go through
it.

## Not seeded, deliberately

**No Drive fixture data is ever generated:** the link columns are nullable so nothing is required, and a
fake folder id would render a link that **errors inside Drive** while leaving the empty-state, dialog and
Files-tab paths — the parts with logic — never exercised in dev. The same reasoning covers the two
transcript tables, which are also never populated; they *are* listed in `SEEDABLE_TABLES`
(`scripts/seed/wipe.ts`) so a reseed still starts from a clean state. Unset env vars locally exercise the off state instead,
which is the honest local situation.

**There is no `test-` name prefix, unlike Slack.** A Slack workspace is singular, so dev and prod share
one and need a marker; a shared drive isn't, so **dev points at a separate shared drive** and test
folders stay out entirely rather than merely being identifiable.

## Where the code is

- `src/lib/drive/scope.ts` — `DRIVE_SCOPE`, its own tiny module because three call sites straddle the
  client/server line (auth config, server-only token accessor, client reconnect button) and **a typo in
  any one fails silently**: the login succeeds and Drive just never works.
- `src/lib/drive/folder.ts` (+ `.test.ts`, 11 tests) — pure, client-importable: kinds, the
  `Sales`/`Projects` parent map, the folder MIME, `buildDriveFolderName`, `driveFolderUrl`,
  `toDriveFolderRef`, `isDriveFolder`, `driveQuoteValue`, `DriveFolderRef`.
- `src/lib/drive/transcript.ts` (+ `.test.ts`, 13 tests) — pure, client-importable, the transcript
  half: the five folder names, `TRANSCRIPTS_SUBFOLDER_NAME`, `GOOGLE_DOC_MIME`, the
  `TRIAGE_WINDOW_DAYS` ladder, **both query builders**, `transcriptWindowStart`, `googleDocUrl`, and
  `TRANSCRIPT_TARGET_LABELS` — keyed on `DriveFolderKind` rather than a parallel enum, so it can't
  drift from the gate's `DRIVE_FOLDER_TARGETS`.
- `src/lib/home/transcripts.ts` (+ `.test.ts`, 20 tests) — the pure payload fold
  (`buildTranscriptViews`; folder ids withheld, fields copied one at a time) **and**
  `groupTranscriptsByDay` + `UNDATED_GROUP_KEY`, the local-calendar-day grouping the list renders.
- `src/lib/db/drive-schema.ts` — `drive_transcript_folders` + `transcript_assignments`.
- `src/actions/drive/` — `driveApi.ts` (transport, `driveList`'s hardcoded scoping, the **private**
  `personalScopedList` + its three transcript callers, `resolveChildFolder`) · `driveToken.ts` ·
  `driveFolderLink.ts` (`DRIVE_FOLDER_TARGETS`, `folderIdsAlreadyLinked`) · `authorizeDriveFolder.ts` ·
  `driveFolder.schema.ts` and `transcript.schema.ts` (both pure, client-imported —
  [ADR 0035](../decisions/0035-schema-modules-by-import-boundary.md); `driveResourceId` is **not** our
  `id` primitive, since Drive ids are Google's) · the seven folder-link actions · the triage set —
  `transcriptFolders.ts` and `transcriptTriage.ts` (both **server-only**, the second so the envelope
  type and its sync helpers have a home a `'use server'` file can't give them), `getTranscriptTriage`,
  `searchTranscripts`, `rescanTranscriptFolders`, `assignTranscript`, `dismissTranscript`,
  `getDismissedTranscripts`,
  `searchTranscriptTargets`, `getAssignableTranscriptKinds` · plus the extractions
  `createRecordFolder.ts` (`createDriveFolder`'s body verbatim) and `copyFailure.ts`.
- `src/components/home/` — `transcript-triage-panel.tsx` · `transcript-row.tsx` ·
  `transcript-assign-dialog.tsx` · `transcript-archive-dialog.tsx`.
- `src/components/drive/` — `drive-folder-field.tsx` (the one slot both surfaces mount) ·
  `drive-folder-dialog.tsx` (create *and* link in one dialog; **`forceMountOverlay` is required**, since
  the opportunity surface is a Sheet) · `drive-files-panel.tsx` (the Files tab body for both surfaces;
  owns its own breadcrumb, because deriving the trail server-side would walk `parents` upward one API
  call per level on every load, for information the click already gave us) ·
  `drive-reconnect-button.tsx` · `use-google-picker.ts`.
- Extended reads: `crm/getOpportunity.ts` (`drive`, the **sales** folder only) ·
  `crm/loadOpportunityDetail.ts` (`driveEnabled` on the envelope) · `projects/getProjectPlan.ts`
  (`drive` as a **sibling** of `project`, not on `PlanProject` — that type is shared with
  `getOpportunityPlan`).
- Env: the three vars in `src/env.ts`, documented in `.env.example` and
  [`guides/google-drive.md`](../guides/google-drive.md).

## Open questions / not built

- **No rename, delete or move of files** from inside the app. The tab lists and adds; Drive is one click
  away for everything else.
- **No folder rename sync** when a record is renamed — the stored name is a display snapshot.
- **No permission management on folders.** Visibility is shared-drive membership, untouched by anything
  here.
- **No reconciliation for a folder deleted in Drive.** The tab reports `no-access`; unlink is the fix.
- **No inheriting an opportunity's sales folder into its project** — many opportunities, one project, no
  unambiguous owner ([ADR 0067 §2](../decisions/0067-slack-channel-links-bot-token-denormalized-pairs-and-record-scoped-gate.md)'s
  reasoning).
- **No mirror of folder contents in our DB.** Drive stays the system of record for files, as Rippling
  does for pay, and no file contents ever pass through our server. (The two transcript tables are not
  that mirror — they hold triage *decisions*, which Drive can't tell us.)
- **No automatic pickup of a new transcript folder.** Discovery is a first-load-only event; a folder
  created later needs the explicit rescan (above). Nothing watches Drive.
- **Nothing reads a transcript's *contents*** — no summarisation, no extraction into notes. Triage
  copies the Doc and records where it went.
- **No un-filing.** Deleting a `transcript_assignments` row (and the copy) has no UI; dismissal is the
  only reversible decision.
- **No in-app paging** past 1000 direct children — the `truncated` notice points at Drive instead.
- **No suggestion row.** A similarity-based folder suggestion (and the extraction of the Slack Dice
  scorer into a shared module) was planned and **dropped**: folder names are the record name verbatim, so
  typing two characters into the search combobox finds it. `src/lib/slack/channel.ts` is untouched. That
  extraction is the first step if a suggestion is ever wanted.
