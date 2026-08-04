# 0069 — Google Drive folder links: the privacy invariant, per-user OAuth on the Google login, and no cached Drive read

**Status:** accepted · 2026-08-04 · **renumbered from a duplicate 0068** on 2026-08-04, when 0068 was
independently taken on `main` by [0068](./0068-delivery-managers-as-project-roles-and-coverage-gaps.md)
(the migration was renumbered `drizzle/0027` → `drizzle/0028` in the same merge, for the same reason)
· **the deliberate sibling of [ADR 0067](./0067-slack-channel-links-bot-token-denormalized-pairs-and-record-scoped-gate.md)**
— same two kinds, same denormalized column pairs, same record-scoped `authorize` gate, and it
**reverses 0067 §1 and §7 on purpose**: this is the repo's **first per-user OAuth integration**
(Slack is one bot token) and it adds **zero cache tags** where 0067 added the repo's first two ·
extends [ADR 0029](./0029-external-fx-rates-and-currency-normalization.md)'s outbound-HTTP posture
(bare `fetch`, Zod at the boundary, no vendor SDK) to a **per-user-credentialed** service ·
`src/lib/drive/` is the `format/fx.ts` case under [ADR 0036](./0036-lib-organized-by-domain-subfolders.md) ·
the gate is [ADR 0014](./0014-rbac-better-auth-access-control.md)'s `ActionAuthorize` hook, so
**no capability and no matrix change** (the lockstep rule is not engaged) · builds on
[ADR 0006](./0006-google-only-auth-and-layout-gating.md) (Google is the only sign-in, which is what
makes this ride the login at all) · migration `drizzle/0028_tense_jocasta.sql` · runbook:
[`guides/google-drive.md`](../guides/google-drive.md) · knowledge: [`domains/drive.md`](../domains/drive.md)

## Context

Opportunities and projects accumulate real artefacts — decks, SOWs, notes, recordings — and until
now they lived in whoever's personal Drive happened to make them. The company already has a shared
drive, **Lazer Home**, shared with everyone, but nothing connected a folder in it to the record it
belonged to, so "the files for this project" meant asking someone.

The shape of the answer was already settled by [ADR 0067](./0067-slack-channel-links-bot-token-denormalized-pairs-and-record-scoped-gate.md):
an opportunity gets a **sales folder** at `Lazer Home/Sales/<opportunity name>`, a project gets a
**project folder** at `Lazer Home/Projects/<project name>`, each a denormalized column pair on the
record, created or linked from that record's own surface. Each surface also gains a **Files** tab
that browses the folder and adds files to it.

What was *not* settled, and is what this ADR is actually about: **Drive is a filesystem people keep
personal things in.** Slack's blast radius was "the app can see channel names"; Drive's is "the app
holds a credential that can read everything you own". Everything below follows from bounding that.

## Decision

### 1. The privacy invariant — three structural guarantees, not conventions

**No file ends up in a shared folder unless the user picked it, and nothing we run ever enumerates
a personal Drive.** This is the first decision, the thing to protect in review, and it is enforced
by the *shape* of the code rather than by policy:

1. **Every listing goes through one function that hardcodes the drive.** `driveList()`
   (`src/actions/drive/driveApi.ts`) sets `corpora=drive`, `driveId=env.GOOGLE_DRIVE_ROOT_ID`,
   `includeItemsFromAllDrives=true` and appends `and trashed = false`. **Scope is not a
   parameter**, so no call site can widen a listing to the caller's own Drive — not by accident and
   not by a future "just add an optional `driveId`". Widening that signature quietly undoes the
   whole design.
2. **Exactly one code path touches a file outside the shared drive:** `copyDriveFile`, and its
   `fileId` always comes from a **Google Picker selection** — the user's own click, in Google's own
   UI. Nothing searches or lists their Drive; we never learn what else they have.
3. **It copies, never moves.** `files.copy` with a `parents` destination. Nothing anywhere rewrites
   a file's `parents`, so pulling a file into a project folder can never quietly remove it from
   someone's own Drive.

Two supporting confinements, both server-side: `linkDriveFolder` and `copyDriveFile` each read the
target's metadata and **refuse anything whose `driveId` isn't `GOOGLE_DRIVE_ROOT_ID`** — so a link
can't point at a folder in someone's personal Drive (which nobody else could open), and this can't
be turned into a general-purpose "copy anything anywhere" endpoint.

**The acknowledged cost is §5's:** authorizing the Picker puts a full-Drive access token in the
browser. That is inherent to the Picker, and it is the price of not building an uploader.

### 2. Per-user OAuth, riding the existing Google login — the repo's first

Every Drive call is made **as the signed-in person**, on their own token. There is no service
account and no "connect Drive" flow: everyone already signs in with Google
([ADR 0006](./0006-google-only-auth-and-layout-gating.md)), so the grant is widened rather than a
second connection being invented.

`src/lib/auth/auth.ts`:

```ts
google: {
  clientId, clientSecret,
  scope: [DRIVE_SCOPE],             // src/lib/drive/scope.ts — one spelling, three call sites
  accessType: "offline",            // without this Google returns NO refresh token
  prompt: "select_account consent",  // `consent` is what re-issues one
},
account: { encryptOAuthTokens: true },
```

**Why this is worth the machinery here when ADR 0067 §1 rejected it for Slack.** For Slack, per-user
OAuth meant a token store, refresh handling and a connect flow to write two columns and open a URL.
Here it buys three things a bot could not:

- **Google enforces authorization for us.** Shared-drive membership is checked by Drive on every
  call, so "can this person see this folder?" is never a question our code answers.
- **Drive's audit trail names the real human.** A folder created by a service account says a robot
  made it; with this, Drive shows *you*.
- **A personal file can be copied in at all.** A bot has no access to anyone's own Drive, so the
  "add from my Drive" half of the feature is impossible without acting as the user.

`accessType` and `prompt` are both **load-bearing, not cosmetic**: Google issues a refresh token
only on an explicit consent with offline access, so dropping either leaves a one-hour access token
and no way to renew it — Drive would work until first lunch. **No `bun run auth:generate` was
needed**: `account` already carries `refreshToken`, `accessTokenExpiresAt` and `scope`.

**`encryptOAuthTokens` was switched on in the same change, deliberately, and that timing is the
decision.** It is free *today* — no refresh tokens exist yet, so nothing needs re-consenting — and
after this change the `account` table holds refresh tokens granting standing full-Drive access to
every employee, which turns a leaked dump from a password reset into a company-wide compromise.
Deferring it would have cost a company-wide re-consent later. The consequence to know: encryption
is keyed on `BETTER_AUTH_SECRET`, and **a Drizzle read of `account.accessToken` now returns
ciphertext**.

**All token access goes through `auth.api.getAccessToken`** (`src/actions/drive/driveToken.ts`),
never a Drizzle read — it decrypts *and* refreshes. That module exists to close three traps, each
of which fails silently otherwise:

| Trap | What happens | What we do |
|---|---|---|
| **No refresh token** | Better Auth only refreshes when `account.refreshToken` is present; with none it returns the **stale** access token and no error, surfacing as an opaque 401 from Drive several calls later | Expiry is re-checked here (30s skew), and a still-expired token is treated as "reconnect" |
| **An old grant has no Drive scope** | A perfectly valid token that cannot touch Drive — everyone who signed in before this change | Checked against `DRIVE_SCOPE`; collapsed into the *same* user-visible outcome as expiry, because it is the same instruction |
| **Better Auth stores `scope` comma-joined**, not space-joined as OAuth does | Re-splitting on spaces makes every scope check silently fail | Use the endpoint's already-split `scopes` array |

Two callers, two shapes, for a reason: `getDriveAccessToken` returns `null` (a read renders a
"reconnect" panel) and `requireDriveAccessToken` throws a user-safe *"Reconnect your Google account
to use Drive."* — the same words the reconnect button is captioned with, so the two read as one
instruction.

**Recovery is `linkSocial`, not a sign-out.** `DriveReconnectButton` calls
`authClient.linkSocial({ provider: "google", scopes: [DRIVE_SCOPE] })` — the documented
incremental-consent path, and Better Auth's Google provider already sends `include_granted_scopes`,
so it **adds** Drive to the existing grant rather than replacing it. The session survives, so nobody
loses their place in the app to fix this.

**The migration cost, stated plainly because it is the thing that will confuse someone:
changing the provider config grants nothing retroactively.** Every existing user must sign out and
back in once (or press reconnect) before Drive works for them. It is a required step in the
[runbook](../guides/google-drive.md), not a footnote.

### 3. The full `drive` scope, not `drive.file`

`DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"` — a *restricted* scope in Google's
classification.

`drive.file` (per-file access, granted only for files the app itself created or the user picked)
is the obvious safer choice and was rejected because it makes **a folder listing structurally
incomplete**: a file a colleague added through Drive's own UI would be invisible to us, so the Files
tab would show a subset of the folder and quietly imply that was all of it. That is the same class
of failure as ADR 0067's private-channel blind spot, except here it would look like data loss.

The scope is usable **without Google verification or a CASA assessment only because the OAuth
consent screen is Internal** — that is a setup constraint, and it is why the runbook says so in
step form. §1 is what replaces the enforcement `drive.file` would have given us.

### 4. No Drive read is cached, and that is a security decision

**This feature adds zero cache tags** — the exact opposite of ADR 0067 §7, which introduced the
repo's first two. Every Drive request carries `cache: "no-store"`.

Slack's reads cache safely *because* there is one bot token: the response is the same for everyone,
so a shared cache entry discloses nothing. Drive calls carry a **per-user** token, so a shared cache
entry is **one person's authorized listing served to another** — a cross-user disclosure, in the one
feature whose whole point is that Google decides who sees what. Do not "optimise" this.

Two follow-ons: `resolveParentFolder` re-resolves `Sales`/`Projects` on **every** create rather than
caching the ids (creates are rare; the read is cheap and per-user), and `getDriveAccessToken` is
called per request rather than memoised.

### 5. The Google Picker instead of an uploader — and two single-view Pickers, not one

**We own no upload code.** The Picker gives us unlimited file size, progress, resumption and
drag-and-drop, none of it ours, and no bytes ever pass through our server.

`useGooglePicker` (`src/components/drive/use-google-picker.ts`) has **two modes, each a Picker with
exactly one view**:

- **`upload`** — `DocsUploadView().setParent(folderId)`. Google's own uploader writes **straight
  into the shared folder**; there is nothing for us to do afterwards but refresh the listing.
- **`pick`** — a `DocsView` over what the user can already see. Picking moves nothing; it hands back
  ids, and the caller copies each in via `copyDriveFile`.

**Why two Pickers rather than one Picker with both views** (a deliberate deviation from the
implementation plan, which specified the combined form): a combined Picker returns **one
undifferentiated `PICKED` list**, so the callback would have to *infer* which documents Google had
already written into the folder and which still needed copying — typically by comparing each
document's parent id. Inferring wrong in the safe direction costs an extra API call; inferring wrong
in the other direction **silently creates a duplicate file**. Two views, two intents, no inference:
**the mode, not the payload, decides what happened.** The cost is one extra button in the UI
("Upload" and "From my Drive"), which also happens to describe the two intents better than one "Add
files" button did.

**The concession, stated plainly:** `setOAuthToken` is the only way to authorize the Picker, so a
**full-Drive access token reaches the browser**. That is inherent to the Picker and is the price of
not building an uploader. It is bounded three ways: the token is the signed-in person's own, it is
short-lived, and it is **fetched per open rather than held**, so a long-lived tab isn't sitting on
one.

`getDrivePickerToken` is therefore the most security-sensitive signature in the feature: it takes
`z.object({})` — **no input at all** — and returns `ctx.user`'s token plus the two public Picker
credentials. **Adding a `userId` parameter, even "just for admins", would turn it into an endpoint
that hands one person a token for another person's entire Drive.** That is not a refactor; stop and
flag it. (The two `NEXT_PUBLIC_*` values are returned from here rather than read from `process.env`
in the component so a half-configured install fails in one place with one message.)

### 6. Denormalized column pairs, not a `drive_folder_links` table

Identical to ADR 0067 §3 and for identical reasons — both relationships are 1:1, and a polymorphic
table needs an untyped `recordId` with no FK (losing the cascade that drops the link when the deal
or project is deleted) plus a join on every detail read.

| Kind | Columns | Folder | Surface | Capability |
|---|---|---|---|---|
| `sales` | `opportunities.salesDriveFolderId` / `…Name` | `Lazer Home/Sales/<opportunity name>` | the opportunity drawer | `crm.edit` |
| `project` | `projects.driveFolderId` / `…Name` | `Lazer Home/Projects/<project name>` | `/projects/[id]` | `projects.edit` |

Per table: a **named** `uniqueIndex` (`opportunities_sales_drive_folder_idx`,
`projects_drive_folder_idx`) so `isUniqueViolation` can key off it — plain, not partial, since
Postgres treats NULLs as distinct — and a **`check`** (`…_drive_folder_shape`) enforcing **both null
or both set**. `drizzle/0028_tense_jocasta.sql` is 4 `ADD COLUMN`, 2 unique indexes, 2 checks and
**no backfill** (all-null rows satisfy the checks).

**Cross-kind uniqueness is a UX rule, not a DB invariant** — the per-table indexes stop a folder
being linked to two opportunities, but nothing at the DB level stops the same folder being both a
sales folder and a project folder. `folderIdsAlreadyLinked` (two indexed `IN` lookups over a
**candidate shortlist**) enforces it in `linkDriveFolder` and hides taken folders from search.
Same call as 0067: it spans two tables and isn't a truth about the data.

One genuine simplification over Slack: **folder names are the record's name verbatim.** Drive has
no slug rules, so there is nothing to slugify and no prefix to strip back off for matching —
`buildDriveFolderName` only normalises whitespace and caps at 255. Note `/` is deliberately **left
alone**: it is legal in a Drive name (Drive has no path syntax; parents are ids), so stripping it
would corrupt "Discovery / Scoping" for no gain. And a folder URL needs no configuration, so
`toDriveFolderRef` lives in the **pure, client-importable** module rather than being server-only
like `toSlackChannelRef` (which needs `SLACK_TEAM_ID`).

### 7. The gate follows the record being written — and browse/copy/search carry none, deliberately

`authorizeDriveFolder` is a copy of `authorizeSlackChannel`: it parses `kind` off the **raw
`clientInput`** and calls `requirePermission(user, DRIVE_FOLDER_TARGETS[kind].permission)`. An
**unparseable kind is denied, not skipped** — a hook that returns early when it can't read its own
discriminant leaves the body running ungated. `DRIVE_FOLDER_TARGETS`
(`src/actions/drive/driveFolderLink.ts`) is the **only** place a kind maps to a table, a column
pair, a capability and a revalidation, so "the hook checked `crm.edit` but the body wrote a
`projects` column" is unrepresentable.

`crm.edit` and `projects.edit` are **disjoint** in the matrix, so **no capability was added and
`src/lib/auth/permissions.ts`, its test and [permissions.md](../domains/permissions.md)'s matrix are
untouched** — ADR 0014's lockstep rule is not engaged, and a `drive.manage` capability would be a
third spelling of "may edit this record".

| Action | Gate |
|---|---|
| `createDriveFolder` · `linkDriveFolder` · `unlinkDriveFolder` | `authorize: authorizeDriveFolder` → `crm.edit` \| `projects.edit` |
| `searchDriveFolders` · `loadDriveFolderContents` · `copyDriveFile` · `getDrivePickerToken` | signed-in only — **no capability** |

**The four ungated actions are the interesting half.** They run on **the viewer's own Google token**,
and `driveList` confines every query to the shared drive, so they can only ever surface or write what
that person could already see and do in Drive's own UI — Google enforces shared-drive membership for
us. A capability gate there would be **theatre**: it would refuse in our UI something the same person
could do in Drive in two clicks, while protecting nothing.

Two consequences worth holding:

- **In practice sales-folder files are still `crm.edit`-only**, because the opportunity Sheet is only
  mounted from the board and table for `crm.edit` holders. That is a **property of the surface, not a
  second gate** — don't rely on it if the drawer is ever opened to non-editors.
- `loadDriveFolderContents` accepts **any** folder id in the shared drive, not only a linked one, so
  the panel can navigate into subfolders. Safe on exactly the reasoning above; it is not an
  oversight.

### 8. Creation is not transactional with the DB write — and Drive has a real delete

`createDriveFolder`'s step order **is the design**, the same reasoning as ADR 0067 §6 but one step
better at the end:

1. `target.read` — reject a missing record or an already-filled slot **before** anything external
   happens (and reject a blank record name, which Drive would refuse at the end of the flow).
2. `resolveParentFolder(kind)` — find `Sales`/`Projects` by name at the drive root, create if
   absent, so a fresh shared drive needs no manual folder setup. Takes the **oldest** match by
   `createdTime`, so a concurrent double-create (Drive permits duplicate names) converges rather
   than forking.
3. **A name-collision precheck** under that parent → if a folder of that name exists, **refuse**
   with *"link it instead of creating another"*. Drive permits duplicate names, and two folders
   called "Acme Rebuild" is a mess nobody can untangle later; refusing with an actionable
   instruction beats silently creating the second.
4. `files.create` — the irreversible-ish call. **The stored name is the one Drive returns**, not the
   one we asked for.
5. `target.link`, guarded on `isNull` (the atomic half of the double-click defence).
6. **If the link lost the race: `files.delete` the folder just created.** This is where it diverges
   from Slack, and it is strictly better — Slack has no `conversations.delete`, so an orphaned
   channel could only be archived, whereas here the folder is empty and seconds old, so the
   compensating action is **exact**. If even that fails, `logger.error("drive_folder_orphaned", …)`
   names the folder so someone can delete it by hand.

`linkDriveFolder` takes the **id only** — the stored name is read back from Drive server-side, so a
client can't make the displayed name disagree with the folder it points at — and it **never touches
the folder**: no rename, no move, no permission change. Linking is a statement about our records, not
an action in Drive. It requires **no naming convention**: any folder in the shared drive is linkable,
because adopting folders that predate the convention is much of the point. **Creating is what
enforces the naming.**

`unlinkDriveFolder` clears the two columns and **nothing else** — which is what the confirmation copy
promises (*"The folder stays in Drive with all its files — this only clears the link here."*). It is
in scope from day one because it is the only escape hatch for the ways a link goes bad: wrong folder
linked, folder deleted or moved out of the shared drive, folder renamed past recognition.

Error mapping lives in a per-action `createFailureError` / `copyFailureError` switch over
`DriveApiError.code`, so each failure names the actual obstacle:
`insufficientFilePermissions`/403 → *"you don't have permission to add folders to the Lazer Home
shared drive"*; `notFound` on the root id → a **setup** bug, logged as `drive_root_not_found` and
reported as *"ask an admin to check the Drive setup"*, not as something the user did;
`cannotCopyFile` → *"the owner of that file has disabled copying"* (the most likely real-world
failure, and one only they can undo); 401 → reconnect; 429 → *"Drive is busy"*.

### 9. The stored folder name is a display snapshot, with no rename sync

`*DriveFolderName` exists **only so a linked folder renders without a Drive round-trip.** Every link
is by **folder id**, so a rename in Drive never breaks the hyperlink — it only makes the label stale.
Nothing writes the name back from a read: that would turn every detail render into a Drive call
(a per-user, uncacheable one, per §4), and the check constraints keep the pair consistent either way.
The create dialog says so inline: *"Renaming the record later will not rename the folder."*

`driveFolderUrl` is `drive.google.com/drive/folders/<id>` — the same URL shape for shared and
personal Drive, needing no configuration, which is why it's in the pure module (§6).

### 10. Reads on a render path never throw, and a one-page listing says so

`loadDriveFolderContents` returns a **status envelope**, following the `getSlackChannels` rule (ADR
0029/0067): a read on a render path must never throw, and these failure states are **ordinary**, each
with a different person who can fix it:

| Status | Means | Who fixes it |
|---|---|---|
| `ok` (+ `truncated`) | the listing | — |
| `reconnect` | no Drive scope, or refresh failed | **them**, in one click (the panel renders `DriveReconnectButton` inline) |
| `no-access` | 403/404 — not a member of Lazer Home, or the folder was deleted in Drive | **someone else** |
| `not-configured` | the env vars aren't set | an admin |
| `unavailable` | timeout, 5xx, rate limit | waiting |

Collapsing these into one "couldn't load files" would make every one of them look like our bug.

**`driveList` fetches ONE page (`pageSize=1000`, Drive's maximum) and does not follow
`nextPageToken`.** A folder with more direct children than that is listed incompletely, so callers
compare their result length against `DRIVE_LIST_PAGE_SIZE` and the envelope carries `truncated`,
which the panel renders as *"this folder holds more files than we can list here — open it in Drive"*.
That is the same honesty `getSlackChannels` shows with `degraded`: **a partial listing rendered as a
complete one is how someone concludes a file isn't there when it is.** Paging the UI is out of scope;
pointing at Drive is the right answer for a folder that big.

The transport (`driveApi.ts`) is a handful of functions, not an SDK — no `googleapis`, per ADR 0029 —
with Zod at the trust boundary, a 10s `AbortSignal.timeout` on every call, and
**`supportsAllDrives=true` on every request** (omit it and shared-drive operations fail in ways that
read as permission errors, sending you hunting for the wrong bug). Unlike Slack, Drive uses real
status codes, so `res.ok` is meaningful; the `error.errors[].reason` string is still extracted,
because 403 covers both "you can't write to this shared drive" and "the owner blocked copying".

### 11. One feature flag, three env vars, and the same five-state field as Slack

`isDriveConfigured()` requires **all three** of `GOOGLE_DRIVE_ROOT_ID`,
`NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` and `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID`. Browsing needs only the
first, but the Picker needs its own two, and **a half-configured install where files list yet nothing
can be added is worse than a feature that is plainly off.** One check, one flag.

It is a cheap synchronous env read, passed to the UI as `driveEnabled` — on the opportunity drawer's
**envelope** (`OpportunityDrawerData`, beside `slackEnabled`) because it describes the *environment*,
not the opportunity, and as a prop to `ProjectDetailView`. **Neither surface gained a Drive
round-trip:** the stored link comes off the row already being read, and the Files tab **lazy-loads
its own contents on open** (the `loadOpportunityPlan` idiom), so one component serves both surfaces
and nobody pays for Drive unless they look.

`DriveFolderField` resolves the same five cases as `SlackChannelField`, including ADR 0067 §10's
amended judgement: **the setup control shows even when Drive isn't configured**, with a muted
*"Google Drive isn't connected"* beneath it, and the row is hidden only from viewers who *also*
couldn't act (`if (!enabled && !folder && !canManage) return null`). A reachable control plus a
reason teaches more than an absent one — otherwise the person whose job it is to connect Drive is the
one person certain never to learn the slot exists. An already-stored link renders either way (the
folder URL is just a URL), and **unlink still works**, being app-side only.

### 12. Not seeded, and dev points at a separate shared drive

`scripts/seed/` is untouched, for ADR 0067 §11's reason: the columns are nullable so nothing is
required, and a fake folder id would render a link that **errors inside Drive** while leaving the
empty-state, dialog and Files-tab paths — the parts with logic — never exercised in dev. Unset env
vars locally exercise the off state instead, which is the honest local situation.

**There is no `test-` name prefix, unlike Slack**, and that asymmetry is deliberate: a Slack
workspace is singular, so dev and prod share one and need a marker to tell their channels apart.
Drive is not — dev points `GOOGLE_DRIVE_ROOT_ID` at a **separate shared drive**, which keeps test
folders out entirely rather than merely identifiable.

### 13. Where the code lives

- **`src/lib/drive/scope.ts`** — `DRIVE_SCOPE`, its own tiny module because three call sites on
  opposite sides of the client/server line need it (the Better Auth config, the server-only token
  accessor, the client reconnect button) and **a typo in any one of them fails silently**: the login
  succeeds and Drive simply never works.
- **`src/lib/drive/folder.ts`** (+ `folder.test.ts`, 11 tests) — pure, client-importable (no `db`,
  no drizzle, no `@/env`): the kinds, the `Sales`/`Projects` parent map, the folder MIME type,
  `buildDriveFolderName`, `driveFolderUrl`, `toDriveFolderRef`, `isDriveFolder`, and
  **`driveQuoteValue`** — Drive's `q` quoting rules, which are not cosmetic: get them wrong on a
  folder named "Sam's deal" and the query fails to parse, the "does this exist" precheck errors out,
  and the create path makes a duplicate instead of refusing. Its own `src/lib` folder under ADR 0036,
  the `src/lib/slack/channel.ts` case: the feature spans two domains, so neither owns it. The test
  file is a further sanctioned exception to [ADR 0037](./0037-unit-tests-removed-except-rbac-matrix.md)
  on the usual grounds — the quoting rules and the name cap are exactly the pure logic worth pinning.
- **`src/actions/drive/`** — `driveApi.ts` (transport + `driveList`'s hardcoded scoping +
  `isDriveConfigured`) · `driveToken.ts` (the three traps of §2) · `driveFolderLink.ts`
  (`DRIVE_FOLDER_TARGETS`, `folderIdsAlreadyLinked`) · `authorizeDriveFolder.ts` ·
  `driveFolder.schema.ts` (pure, client-imported per [ADR 0035](./0035-schema-modules-by-import-boundary.md);
  note `driveResourceId` is **not** our `id` primitive — Drive ids are Google's, so they're
  constrained to `[A-Za-z0-9_-]` to keep a hostile value out of a `q` string or a URL path) · and the
  seven actions.
- **`src/components/drive/`** — `drive-folder-field.tsx` (the one slot both surfaces mount) ·
  `drive-folder-dialog.tsx` (create *and* link in one dialog; `forceMountOverlay` is **required**,
  since the opportunity surface is a Sheet) · `drive-files-panel.tsx` (the Files tab body, used
  unchanged by both surfaces; owns its own breadcrumb, because deriving the trail server-side would
  walk `parents` upward one API call per level on every load, for information the click already gave
  us) · `drive-reconnect-button.tsx` · `use-google-picker.ts`.
- **Reads extended, no new queries:** `crm/getOpportunity.ts` (`drive` = the **sales** folder only) ·
  `crm/loadOpportunityDetail.ts` (`driveEnabled` on the envelope) · `projects/getProjectPlan.ts`
  (`drive` as a **sibling** of `project`, not on `PlanProject` — that type is shared with
  `getOpportunityPlan`).
- **Env:** `GOOGLE_DRIVE_ROOT_ID`, `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`,
  `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID` in `src/env.ts`, documented in `.env.example` and
  [`guides/google-drive.md`](../guides/google-drive.md).

## Consequences

- **The `account` table is now a high-value secret store.** It holds encrypted refresh tokens
  granting standing full-Drive access for every employee, keyed on `BETTER_AUTH_SECRET`. Rotating
  that secret invalidates them (everyone reconnects); leaking it is materially worse than before this
  change. Never log a token, and never read `account.accessToken` with Drizzle.
- **A one-time, company-wide re-login is required.** Adding the scope grants nothing retroactively.
  Until someone signs out and back in (or reconnects), their Files tab shows `reconnect` — which is
  the correct rendering, not a bug.
- **This feature adds no cache tags, and must not.** ADR 0067's `updateTag` discipline applies to the
  Slack listing only; the equivalent here would be a cross-user disclosure (§4).
- **A Drive access token reaches the browser** whenever the Picker opens (§5). That is the single
  accepted concession, and `getDrivePickerToken`'s empty input schema is what bounds it.
- **No permission changed.** Don't "tidy" the `authorize` hook into a static `metadata.permission`,
  and don't add a capability to the four ungated actions — §7 is why they have none.
- **The CRM and Projects domains each gained a second external dependency** (Slack was the first),
  and neither blocks on it to render: the link comes off the row, the listing is lazy (§11).
- **A folder can be orphaned in Drive** only if `files.create` succeeds and both the link *and* the
  compensating delete fail. `drive_folder_orphaned` names it; there is no reconciliation job.
- **A folder deleted in Drive is not detected.** The columns keep pointing at it and the Files tab
  reports `no-access`; unlink is the fix. Deliberate — see *out of scope*.
- **`resolveParentFolder` creates `Sales`/`Projects` on first use**, so the first person to create a
  folder in a fresh shared drive is also the person who (silently) creates its top-level structure.
- **The similarity-based folder suggestion was dropped**, and with it the planned extraction of the
  Slack Dice scorer into `src/lib/core/similarity.ts`. `src/lib/slack/channel.ts` keeps its private
  implementation, untouched. It was marked optional in the plan and is genuinely unnecessary here:
  folder names are the record name **verbatim**, so typing two characters into the search combobox
  finds the folder. If a suggestion is ever wanted, that extraction is the first step.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| **A service account** owning every folder | Loses Drive's attribution to a robot (every file "created by lazer-psa@…"), can't reach anyone's personal Drive so the "add from my Drive" half is impossible, and makes *us* the authorizer instead of Google (§2) |
| **The narrower `drive.file` scope** | Browsing becomes structurally incomplete — a file a colleague added in Drive's own UI would be invisible, so the Files tab would silently show a subset of the folder (§3) |
| A `drive.readonly` + `drive.file` combination | Two scopes to reason about, and `drive.readonly` is *also* restricted, so it buys none of the verification relief that was the only reason to narrow (§3) |
| **A separate "Connect Google Drive" flow** | A second connection to manage for something that rides an existing Google login; every user would have to opt in before the feature worked at all (§2) |
| Deferring `encryptOAuthTokens` | Free today (no refresh tokens exist yet); deferring buys a company-wide re-consent later, for nothing (§2) |
| Reading `account.accessToken` with Drizzle | Returns ciphertext with encryption on, and skips the refresh — `auth.api.getAccessToken` does both (§2) |
| Signing everyone out to force the new scope | `linkSocial` incremental consent adds Drive to the existing grant without destroying the session (§2) |
| **Caching the folder listing** (or the parent-folder ids) | Per-user tokens make a shared cache entry a cross-user disclosure — the opposite call to ADR 0067 §7, for the opposite reason (§4) |
| **Our own uploader** (multipart / resumable to `files.create`) | Bytes through our server, plus size limits, progress, resumption and drag-and-drop all to build and maintain — the Picker gives all of it for one browser-side token (§5) |
| **One Picker with both views** (as the plan specified) | Returns one undifferentiated `PICKED` list, so the caller must *infer* upload-vs-pick; inferring wrong creates duplicate files. Mode, not payload, decides (§5) |
| Moving a picked file instead of copying it | Would silently remove it from someone's personal Drive; nothing in this feature ever rewrites `parents` (§1) |
| A polymorphic `drive_folder_links` table | Untyped `recordId`, no FK, no delete cascade, plus a join on every detail read — for two 1:1 relationships (§6) |
| A DB constraint for cross-kind uniqueness | Spans two tables and isn't a truth about the data; enforced in `linkDriveFolder` + `folderIdsAlreadyLinked` (§6) |
| A `drive.manage` capability | A third spelling of "may edit this record"; identical audiences, and a matrix row would engage ADR 0014's lockstep for nothing (§7) |
| A capability gate on browse / copy / search | Theatre: they run on the viewer's own token, so Google already enforces membership, and they'd refuse in our UI what the same person can do in Drive in two clicks (§7) |
| A `userId` on `getDrivePickerToken` | Hands one person a token for another person's entire Drive. Not a refactor — flag it (§5) |
| Validating that a listed folder is the *linked* one | The panel must navigate subfolders, and `driveList` + the user's own token already bound what's reachable (§7) |
| Following `nextPageToken` in `driveList` | A folder over 1000 direct children is better served by Drive itself; the `truncated` flag says so rather than paging our own table (§10) |
| Slugifying folder names | Drive has no slug rules, and stripping `/` would corrupt legitimate names like "Discovery / Scoping" (§6) |
| Renaming the folder when the record is renamed | Same call as the Slack channel name: the link is by id, the stored name is a snapshot, and a rename sync is a write into Drive we don't own (§9) |
| Carrying an opportunity's sales folder over to its project | ADR 0067 §2's reasoning verbatim: many opportunities → one project, so no unambiguous owner. Two folders, two lifecycles |
| Per-file records in our DB | Drive stays the system of record for files, as Rippling does for pay; a mirror table would be stale the moment someone uses Drive directly |
| A `drive_folder` seed fixture | A fake folder id renders a link that errors inside Drive, and leaves the empty-state/dialog paths unexercised (§12) |
| A `test-` prefix on dev folder names | A shared drive isn't singular the way a Slack workspace is — point dev at a **separate** drive and the problem doesn't exist (§12) |
| The `googleapis` SDK | ADR 0029's posture: a few `fetch` wrappers, Zod at the boundary, no vendor client to keep current (§10) |
