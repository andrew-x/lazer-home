# Domain: Google Drive folders

**Status: built (one slice).** Two kinds of Drive folder are linked to PSA records — a **sales
folder** on an opportunity and a **project folder** on a project — with create / link / unlink, plus a
**Files** tab on each surface that browses the folder and adds files to it. Nothing else about Drive
exists: no rename/delete/move of files, no permission management, no per-file records in our DB.

This is not a sixth business domain; it's a **cross-domain integration** that CRM and Projects each own
half of — the same shape as [slack.md](./slack.md), and deliberately modelled on it. It gets its own doc
because neither [crm.md](./crm.md) nor [projects.md](./projects.md) owns the shared machinery, which is
the same reason `src/lib/drive/` exists at all
([ADR 0036](../decisions/0036-lib-organized-by-domain-subfolders.md)). Full rationale:
[ADR 0071](../decisions/0071-google-drive-folder-links-per-user-oauth-and-the-privacy-invariant.md).
Setup procedure: [`guides/google-drive.md`](../guides/google-drive.md).

## The privacy invariant — read this first

Drive is a filesystem people keep personal things in, so **the defining design of this feature is what
it structurally cannot do.** Three guarantees, enforced by the shape of the code rather than by policy:

1. **We never enumerate anyone's personal Drive.** Every listing goes through `driveList()`
   (`src/actions/drive/driveApi.ts`), which **hardcodes** `corpora=drive` +
   `driveId=env.GOOGLE_DRIVE_ROOT_ID`. **Scope is not a parameter**, so no call site can widen a
   listing — not by accident, and not by someone later adding "an optional `driveId`". Widening that
   signature undoes the whole design; that is the review tripwire.
2. **Exactly one path touches a file outside the shared drive:** `copyDriveFile`, whose `fileId` always
   comes from a **Google Picker** selection — the user's own click, in Google's UI.
3. **It copies, never moves.** Nothing anywhere rewrites a file's `parents`, so pulling a file into a
   project folder can't quietly remove it from someone's own Drive.

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

The gate on the three **link** actions is an **`ActionAuthorize` hook**, `authorizeDriveFolder`: it
parses `kind` off the raw `clientInput` and requires the capability belonging to **the record being
written** — `crm.edit` for `sales`, `projects.edit` for `project`.

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

## What each action does

All seven live in `src/actions/drive/`.

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

`scripts/seed/` is untouched: the columns are nullable so nothing is required, and a fake folder id would
render a link that **errors inside Drive** while leaving the empty-state, dialog and Files-tab paths —
the parts with logic — never exercised in dev. Unset env vars locally exercise the off state instead,
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
- `src/actions/drive/` — `driveApi.ts` · `driveToken.ts` · `driveFolderLink.ts`
  (`DRIVE_FOLDER_TARGETS`, `folderIdsAlreadyLinked`) · `authorizeDriveFolder.ts` ·
  `driveFolder.schema.ts` (pure, client-imported —
  [ADR 0035](../decisions/0035-schema-modules-by-import-boundary.md); `driveResourceId` is **not** our
  `id` primitive, since Drive ids are Google's) · the seven actions.
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
- **No per-file records in our DB.** Drive stays the system of record for files, as Rippling does for
  pay. No file contents ever pass through our server.
- **No in-app paging** past 1000 direct children — the `truncated` notice points at Drive instead.
- **No suggestion row.** A similarity-based folder suggestion (and the extraction of the Slack Dice
  scorer into a shared module) was planned and **dropped**: folder names are the record name verbatim, so
  typing two characters into the search combobox finds it. `src/lib/slack/channel.ts` is untouched. That
  extraction is the first step if a suggestion is ever wanted.
