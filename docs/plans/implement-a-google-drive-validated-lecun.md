# Google Drive folder links + Files tabs

## Context

Opportunities and projects accumulate real artefacts — decks, SOWs, notes, recordings — and
today they live in whoever's personal Drive happened to make them. The company already has a
shared drive, **Lazer Home**, shared with everyone, but nothing connects a folder in it to the
record it belongs to, so finding "the files for this project" means asking someone.

This adds that link, deliberately mirroring the Slack channel integration (ADR 0067): an
opportunity gets a **sales folder** at `Lazer Home/Sales/<opportunity name>`, a project gets a
**project folder** at `Lazer Home/Projects/<project name>`, each a denormalized column pair on
the record, created or linked from that record's own surface. Each surface also gains a **Files**
tab that browses the folder and adds files to it.

Everyone signs in with Google already, so Drive access rides on that login rather than being a
second connection to manage — the OAuth grant gains Drive scope and offline access, and every
Drive call is made **as the signed-in person**. That is what makes the permission story simple:
Google enforces shared-drive membership for us, and Drive's own audit trail names the real human
rather than a robot.

The privacy requirement is the sharpest constraint: **no file ends up in a shared folder unless
the user picked it.** That is enforced structurally, not by policy — see _The privacy invariant_.

## Decisions already settled

| Decision | Choice |
|---|---|
| Trust model | **Per-user OAuth, full `drive` scope**, requested as part of the Google login (`accessType: "offline"` for refresh). Every Drive call acts as the signed-in user. |
| Token storage | **Enable `account.encryptOAuthTokens`.** Free today (no refresh tokens exist yet); a company-wide re-consent if deferred. |
| Shared drive config | **One env var**, `GOOGLE_DRIVE_ROOT_ID`. `Sales` / `Projects` resolved by name under it, created on first use. |
| Folder naming | `Lazer Home/Sales/<opportunity name>` and `Lazer Home/Projects/<project name>`. |
| Upload | **No upload code of ours.** Google Picker with two views: `DocsUploadView().setParent(folder)` (Google writes the bytes) and a `DocsView` over the user's own Drive (we `files.copy` the picked file in). |
| Permissions | Create/link/unlink → `crm.edit` \| `projects.edit`, resolved from the kind by `metadata.authorize`. Browse + add files → any signed-in user. **No new capability, no matrix change.** |
| Affordance | A `DriveFolderField` in the meta rail (mirroring `SlackChannelField`) owns create/link/unlink; the **Files** tab browses and adds. |

## The privacy invariant

Three structural guarantees, not conventions. These are the ADR's first decision and the thing
to protect in review:

1. **We never enumerate a user's personal Drive.** Every listing goes through a single
   `driveList()` helper that *hardcodes* `corpora=drive` + `driveId=GOOGLE_DRIVE_ROOT_ID`. No
   call site can widen the scope, because no call site supplies it.
2. **The only code path that touches a personal file is `copyDriveFile`,** and its `fileId`
   comes from a Picker selection — the user's own click, in Google's UI.
3. **We copy, never move.** `files.copy` with a `parents` destination; nothing ever rewrites a
   file's `parents`, so the original stays exactly where it was.

The Picker choice concedes one thing, and the ADR should say so plainly: the browser holds a
full-Drive access token for the token's lifetime, because `setOAuthToken` is the only way to
feed Picker. That is inherent to Picker and is the price of not building an uploader.

## Constraints worth knowing before you start

- **Do not cache any Drive read.** Slack's reads cache safely because there is one bot token;
  Drive reads are per-user, so a shared cache entry is a cross-user disclosure risk. Every Drive
  request uses `cache: "no-store"`. Do not reach for `next: { revalidate, tags }` here — this
  feature adds no cache tags. (Creates are rare, so resolving `Sales`/`Projects` on each create
  is fine and needs no cache.)
- **Reads on a render path must never throw** (the `getSlackChannels` rule). The folder listing
  returns a status envelope, because "you aren't a member of this shared drive" is an ordinary
  outcome, not an error.
- **No vendor SDK.** ADR 0029/0067: bare `fetch` against `www.googleapis.com/drive/v3`, Zod at
  the trust boundary, explicit `AbortSignal.timeout`. Do **not** add `googleapis`.
- **Existing sessions have no Drive scope.** Changing the provider config does not retroactively
  grant anything — every user must sign in again once (or use the reconnect affordance below).
  Build that path; it is also the recovery path when someone revokes access in Google settings.
- **Every Drive call needs `supportsAllDrives=true`.** Without it, shared-drive operations fail
  in ways that read as permission errors.
- **Opportunities have no detail route** — detail is a Sheet over the board. Any dialog opened
  from it needs `forceMountOverlay`, and refresh happens through the sheet's `refresh` callback,
  not `revalidatePath`.
- **No HTML entities in `"use client"` components** (`.claude/rules/ui.md`) — write `doesn't`
  literally. Note the existing Slack components violate this; don't copy that.
- Read the relevant guide under `node_modules/next/dist/docs/` before using a Next API — this is
  a modified Next 16.2.10 build (`.claude/rules/nextjs.md`).

## Google Cloud + Workspace setup (prerequisite, runbook material)

1. In the existing Cloud project: enable the **Google Drive API** and the **Google Picker API**.
2. OAuth consent screen set to **Internal** — this is what lets us use the restricted `drive`
   scope with no Google verification or CASA assessment.
3. Add `https://www.googleapis.com/auth/drive` to the OAuth client's scopes.
4. Create an **API key** (restrict it to the Picker API) → `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`.
5. Note the Cloud **project number** → `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID`.
6. Copy the **Lazer Home** shared drive id from its URL → `GOOGLE_DRIVE_ROOT_ID`.
7. For dev, point `GOOGLE_DRIVE_ROOT_ID` at a **separate** shared drive. This is why there is no
   `test-` name prefix (Slack needs one because a workspace is singular; Drive is not).

## Environment

Add to `src/env.ts` (and `.env.example`, following the Slack block's commenting style):

```ts
// Optional: setting all three turns on the Google Drive folder integration.
GOOGLE_DRIVE_ROOT_ID: optionalString,
NEXT_PUBLIC_GOOGLE_PICKER_API_KEY: optionalString,
NEXT_PUBLIC_GOOGLE_PICKER_APP_ID: optionalString,
```

`isDriveConfigured()` requires **all three**. One flag, no half-configured state where browsing
works but adding files silently can't.

## Auth changes — `src/lib/auth/auth.ts`

```ts
google: {
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  scope: ["https://www.googleapis.com/auth/drive"],
  accessType: "offline",              // without this Google returns no refresh token
  prompt: "select_account consent",   // `consent` is required to re-issue a refresh token
},
…
account: { encryptOAuthTokens: true },
```

`accessType: "offline"` and `prompt: "…consent"` are both load-bearing: Google issues a refresh
token only on an explicit consent, so omitting either leaves us with a one-hour access token and
no way to renew it. No `bun run auth:generate` is needed — `account` already has every column
(`refreshToken`, `accessTokenExpiresAt`, `scope`); confirmed in `drizzle/0000_lethal_rictor.sql`.

Token access goes through **`auth.api.getAccessToken`**, never a Drizzle read of
`account.accessToken` — it refreshes when expired *and* decrypts, and with encryption on a direct
read returns ciphertext. New `src/actions/drive/driveToken.ts`:

```ts
/** The current user's Drive token, refreshed if stale. Null when Drive was never granted. */
export async function getDriveAccessToken(userId: string): Promise<string | null>
/** Same, but throws a user-safe "Reconnect your Google account" error. */
export async function requireDriveAccessToken(userId: string): Promise<string>
```

Map Better Auth's `TOKEN_REFRESH_NOT_SUPPORTED` / `FAILED_TO_GET_ACCESS_TOKEN`, and a `scopes`
array missing the Drive scope, to the same "reconnect" outcome — from the UI's point of view
they are one state. Note Better Auth stores `scope` **comma**-joined, not space-joined.

Reconnect affordance: a small client component calling
`authClient.linkSocial({ provider: "google", scopes: ["https://www.googleapis.com/auth/drive"] })`
— the documented incremental-consent path, and Better Auth's Google provider already sends
`include_granted_scopes: true`, so it composes rather than replacing the existing grant.

## Data model

Two column pairs, mirroring Slack exactly — no `drive_folder_links` table, for the reasons ADR
0067 §3 gives (both relationships are 1:1; a polymorphic table needs an untyped `recordId` with
no FK and a join on every detail read).

`src/lib/db/opportunities-schema.ts`:
```ts
salesDriveFolderId: text(),
salesDriveFolderName: text(),   // display snapshot, like the Slack name
…
uniqueIndex("opportunities_sales_drive_folder_idx").on(t.salesDriveFolderId),
check("opportunities_sales_drive_folder_shape", sql`(both null) or (both set)`),
```

`src/lib/db/projects-schema.ts`: the same with `driveFolderId` / `driveFolderName` and
`projects_drive_folder_idx`. Then `bun run db:generate` → `bun run db:migrate`. No backfill —
all-null rows satisfy the checks. Not seeded, for ADR 0067 §11's reason: a fake folder id renders
a link that errors inside Drive.

## Backend

**Pure, client-importable — `src/lib/drive/folder.ts`** (+ `folder.test.ts`). Justified in its own
`src/lib` folder under ADR 0036, same as `src/lib/slack/channel.ts`: it spans two domains, so
neither owns it. No `db`, no drizzle, no `@/env`.

```ts
export const DRIVE_FOLDER_KINDS = ["sales", "project"] as const;
export const DRIVE_PARENT_FOLDER_NAME: Record<DriveFolderKind, string> = { sales: "Sales", project: "Projects" };
export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export function buildDriveFolderName(sourceName: string): string   // trim, collapse whitespace, cap 255
export function driveFolderUrl(folderId: string): string           // drive.google.com/drive/folders/<id>
export type DriveFolderRef = { id: string; name: string; url: string };
export function toDriveFolderRef(id: string | null, name: string | null): DriveFolderRef | null;
```

Note this is simpler than the Slack equivalent in two ways: folder names are the record name
verbatim (no slugification), and the URL needs no env var, so `toDriveFolderRef` can live in the
pure module rather than being server-only like `toSlackChannelRef`.

**Transport — `src/actions/drive/driveApi.ts`** (`import "server-only"`), modelled directly on
`src/actions/slack/slackApi.ts`:

- `isDriveConfigured()`, `DriveApiError { code, status }`, `DRIVE_NOT_CONFIGURED`
- `driveGet` / `drivePost` / `driveDelete` — each takes the caller's `accessToken`, sets
  `cache: "no-store"` and `AbortSignal.timeout(10_000)`, always sends `supportsAllDrives=true`,
  Zod-validates the body, and maps Drive's error envelope (`error.errors[].reason`, plus HTTP
  401/403/404/429) onto `DriveApiError` codes.
- **`driveList(accessToken, q, fields)`** — the guarantee from _The privacy invariant_ §1. It
  hardcodes `corpora=drive`, `driveId=env.GOOGLE_DRIVE_ROOT_ID`, `includeItemsFromAllDrives=true`
  and `and trashed = false`, so the drive scoping is not a parameter any caller could omit.
- `resolveParentFolder(accessToken, kind)` — find `Sales`/`Projects` by name under the drive root,
  create if absent. Take the oldest match by `createdTime` so a concurrent double-create (Drive
  permits duplicate names) converges rather than forking.

**Registry — `src/actions/drive/driveFolderLink.ts`.** A direct analogue of
`SLACK_CHANNEL_TARGETS` in `src/actions/slack/slackChannelLink.ts` — copy that file's shape and
its header comment's reasoning, which applies verbatim: the two kinds are gated by *disjoint*
capabilities, so the authorize hook and every action body must read the table mapping kind →
table/columns/capability/revalidation from **one** place, or someone with only `crm.edit` could
write a `projects` column.

```ts
export const DRIVE_FOLDER_TARGETS: Record<DriveFolderKind, DriveFolderTarget> = { sales: …, project: … };
export async function folderIdsAlreadyLinked(folderIds: string[]): Promise<Set<string>>;
```

Same `link()` shape with the `isNull` guard for the double-click race, same
`uniqueConstraint` field for `isUniqueViolation`, same `revalidate` (`revalidatePath("/opportunities")`
vs `revalidateProject(recordId)`).

**Gate — `src/actions/drive/authorizeDriveFolder.ts`.** A copy of `authorizeSlackChannel`:
parse `kind` off `clientInput`, `requirePermission(user, DRIVE_FOLDER_TARGETS[kind].permission)`,
and an unparseable kind is **denied, not skipped**.

**Schemas — `src/actions/drive/driveFolder.schema.ts`** (pure, client-importable per ADR 0035 —
the dialog imports it). `driveFolderKindSchema`, `driveFolderTargetSchema` (`{ kind, recordId }`),
plus `create` / `link` (`+ folderId`) / `unlink` / `listContents` (`+ folderId?`) /
`copyFile` (`+ folderId, fileId`) / `searchDriveFolders` (extends `searchQuerySchema`).

**Actions** — one per file, `secureActionClient`, all the folder-mutating ones carrying
`.metadata({ action: …, authorize: authorizeDriveFolder })`:

| File | Input | Returns | Gate |
|---|---|---|---|
| `createDriveFolder.ts` | `{ kind, recordId }` | `{ folderId, folderName }` | `authorize` |
| `linkDriveFolder.ts` | `{ kind, recordId, folderId }` | `{ folderId, folderName }` | `authorize` |
| `unlinkDriveFolder.ts` | `{ kind, recordId }` | `{ recordId }` | `authorize` |
| `searchDriveFolders.ts` | `{ query }` | `Array<{ id, name }>` (`SearchAction`) | signed-in |
| `loadDriveFolderContents.ts` | `{ folderId }` | status envelope, below | signed-in |
| `copyDriveFile.ts` | `{ folderId, fileId }` | `{ fileId, name }` | signed-in |
| `getDrivePickerToken.ts` | `{}` | `{ accessToken }` | signed-in, **`ctx.user` only** |

`getDrivePickerToken` must **never** accept a `userId` — it returns a token for `ctx.user` and
nothing else. Flag any change to that signature as a vulnerability.

The three signed-in-only actions are deliberate, per the settled permission decision: they can
only surface or write what the user could already see and do in Drive's own UI, because they run
on that user's token and Google enforces shared-drive membership. In practice opportunity files
are still `crm.edit`-only, because the opportunity Sheet is only mounted from the board and table
for `crm.edit` users — a consequence of the surface, not a second gate.

`createDriveFolder` step order — the same reasoning as ADR 0067 §6, one step shorter because
**Drive has a real delete where Slack has none**, so the compensating action is exact:

1. `target.read` → reject a missing record or an already-linked slot.
2. `resolveParentFolder(kind)`.
3. `driveList` for an existing folder of that name under the parent → if found, refuse with
   "a folder with this name already exists — link it instead" rather than making a duplicate.
4. `files.create` the folder.
5. `target.link` under the `isNull` guard.
6. If the link lost the race: `files.delete` the folder just created, and
   `logger.error("drive_folder_orphaned", …)` if even that fails.

Error mapping in a `createFailureError(error)` switch, mirroring `createSlackChannel.ts`:
`DRIVE_NOT_CONFIGURED`, `insufficientFilePermissions` / 403 on the shared drive ("you don't have
write access to Lazer Home"), `notFound` on the root id (a misconfigured env var — log it, it's a
setup bug not a user error), 401 → reconnect, 429 → rate limited.

`loadDriveFolderContents` returns a status envelope rather than throwing, because "not a member of
the shared drive" and "Drive was never granted" are ordinary states the tab must render:

```ts
type DriveFolderContents =
  | { status: "ok"; entries: DriveEntry[] }
  | { status: "reconnect" }        // no Drive scope, or refresh failed
  | { status: "no-access" }        // 404/403 — not a member, or the folder was deleted in Drive
  | { status: "unavailable" };     // timeout, 5xx, rate limit
type DriveEntry = { id; name; mimeType; isFolder; webViewLink; modifiedTime; modifiedBy: string | null };
```

Request `fields=files(id,name,mimeType,webViewLink,modifiedTime,lastModifyingUser(displayName))`
and `orderBy=folder,name`. Use the API's `webViewLink` for opening a file — don't construct it.

`copyDriveFile` is `POST /files/{fileId}/copy` with `{ parents: [folderId] }`. Map
`cannotCopyFile` (the owner set `copyRequiresWriterPermission`) to its own message — it's the
most likely real-world failure and "something went wrong" would be useless.

**Reads to extend — no new queries.** Add the column pair to the existing selects and expose a
`drive: DriveFolderRef | null`:

- `src/actions/crm/getOpportunity.ts` → `OpportunityDetail.drive`
- `src/actions/crm/loadOpportunityDetail.ts` → `driveEnabled: isDriveConfigured()` on the
  **envelope**, beside `slackEnabled` (not on `OpportunityDetail`)
- `src/actions/projects/getProjectPlan.ts` → `drive` as a sibling of `project`, like `slack`

Note what is deliberately *not* added: no new SSR read on `/projects/[id]` or in the opportunity
sheet payload. The Files tab lazy-loads its own contents, following
`OpportunityProjectPlan`'s `loadOpportunityPlan` precedent, so the tab costs nothing until opened
and one component serves both surfaces.

## Frontend

All in `src/components/drive/`. Reuse `FormField`, `FormDialog`/`FormDialogFooter`,
`EntityCombobox`, `ConfirmDialog`, `InlineNotice`, `ExternalLink`, `IconButton`, `EmptyState`,
`DetailSection`, `TableEmpty`. Tabler icons only.

**`drive-folder-field.tsx`** — the meta-rail field, a close analogue of
`src/components/slack/slack-channel-field.tsx`, including its five-state guard: linked (folder
name as an `ExternalLink`, unlink `IconButton` in `FormField`'s `labelAction`), empty + can manage
(outline "Create or link" button, shown **even when Drive isn't configured**, with a muted "Google
Drive isn't connected" line — ADR 0067 §10's reasoning, that a reachable control plus a reason
teaches more than an absent one), empty + can't manage (muted "Not linked"), and
`if (!enabled && !folder && !canManage) return null`. Unlink goes through `ConfirmDialog` with copy
that says what isn't destroyed: *"The folder stays in Drive with all its files — this only clears
the link here."*

**`drive-folder-dialog.tsx`** — create-or-link, mirroring `slack-channel-dialog.tsx`: read-only
preview of the folder path that will be created (`Lazer Home / Sales / <name>`), a `Separator …
or link an existing folder … Separator` divider, then an `EntityCombobox` over
`searchDriveFolders` beside a Link button. `forceMountOverlay` — required when opened from the
opportunity Sheet. `searchArgs` must be `useMemo`'d. Search spans every folder in Lazer Home, not
just the ones under `Sales`/`Projects`, for the reason `searchSlackChannels` documents: folders
that predate the convention are exactly the ones people need to link.

**`drive-files-panel.tsx`** — the Files tab body, used by both surfaces:

- Lazy-loads via `useAction(loadDriveFolderContents)` in a `useEffect` on mount.
- Breadcrumb from the linked folder root, clickable to navigate into subfolders. Folder rows
  navigate in place; file rows are `ExternalLink`s to `webViewLink` with `target="_blank"`.
- Header: the folder as an "Open in Drive" `ExternalLink`, and a primary **Add files** button.
- Table columns: name (with a folder/file icon), modified, modified by.
- Empty → `EmptyState`. `status: "reconnect"` → an `InlineNotice` with the reconnect button.
  `"no-access"` → an `InlineNotice` explaining they aren't a member of Lazer Home and who to ask.
  Unlinked → a muted line pointing at the rail control (the duplicated empty state the chosen
  affordance layout accepts).
- After the Picker closes having added anything, re-run the load action. Google writes the file
  without telling our server, so nothing else will refresh the list.

**`use-google-picker.ts`** — a hook that loads `https://apis.google.com/js/api.js` once
(idempotent, module-level promise), calls `gapi.load("picker")`, fetches the token via
`getDrivePickerToken`, and builds:

```ts
new google.picker.PickerBuilder()
  .setDeveloperKey(process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY)
  .setAppId(process.env.NEXT_PUBLIC_GOOGLE_PICKER_APP_ID)
  .setOAuthToken(accessToken)
  .addView(new google.picker.DocsUploadView().setParent(folderId))   // Google uploads for us
  .addView(new google.picker.DocsView().setOwnedByMe(true).setIncludeFolders(true))
  .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
  .setCallback(…)
```

The `DocsUploadView` needs no follow-up call from us — `setParent` makes Google write straight
into the folder. Only `DocsView` picks need one: for each returned doc, call `copyDriveFile`.
Distinguish the two in the callback by whether the doc's id is already inside the folder — or
more simply, by tracking which view produced the selection (`doc[google.picker.Document.TYPE]`
plus the upload view's own `PICKED` payload). Verify this against a real Picker response during
implementation; the exact payload shape is the one part of this plan not confirmed from docs.
`@types/google.picker` may be needed for types, or hand-declare the narrow surface used.

**Mount points**

- `src/components/projects/detail/project-detail-view.tsx` — `DriveFolderField` after the Slack
  row in the sidebar `SidebarSection`; a `<TabsTrigger value="files">Files</TabsTrigger>` between
  "Delivery notes" and "Time off", with the panel in a `DetailSection`.
- `src/components/crm/opportunity-detail/sheet.tsx` — `DriveFolderField` under the Slack row in
  the meta rail; a third tab, **Details · Project plan · Files**. Pass `refresh` as `onChanged`,
  since the drawer holds its own client-side state.

Tabs here are plain local `Tabs` state — this repo has no `?tab=` deep-linking anywhere, so don't
introduce it for this.

## Shared refactor: the similarity scorer

`src/lib/slack/channel.ts` holds a private Sørensen–Dice implementation
(`diceCoefficient`, `bigrams`, containment floor `0.7`) used by `scoreSlackChannelMatch`. The
optional Drive folder suggestion wants the same maths. Extract the scorer to a pure shared module
(`src/lib/core/similarity.ts`) and have `scoreSlackChannelMatch` keep only its Slack-specific
prefix-stripping wrapper. Move the relevant cases from `src/lib/slack/channel.test.ts` alongside
it, and keep the Slack wrapper's tests where they are.

## Build order

1. Google Cloud + Workspace setup, env vars, `src/env.ts`.
2. Auth config (scope, `accessType`, `prompt`, `encryptOAuthTokens`) + `driveToken.ts` + the
   reconnect component. **Verify a real token with Drive scope arrives before building on it** —
   everything downstream is dead until this works.
3. Schema + migration.
4. `src/lib/drive/folder.ts` + tests.
5. `driveApi.ts` (including `driveList`'s hardcoded scoping) + `driveFolderLink.ts` +
   `authorizeDriveFolder.ts` + schemas.
6. Actions, in the order: `loadDriveFolderContents` → `createDriveFolder` → `linkDriveFolder` /
   `unlinkDriveFolder` / `searchDriveFolders` → `getDrivePickerToken` → `copyDriveFile`.
7. Extend the three reads.
8. `DriveFolderField` + dialog; mount on both surfaces.
9. `DriveFilesPanel` + the Files tabs (browse only).
10. `use-google-picker.ts` + the Add files button.
11. Optional, droppable: the similarity extraction + `suggestDriveFolder` + an inline suggestion
    row mirroring `slack-channel-suggestion.tsx`. Everything else stands without it — folder names
    are the record name verbatim, so typing two characters into the search combobox finds it.

## Docs

Dispatch the **`librarian`** subagent after implementing (automatic per `AGENTS.md`), with:

- **ADR 0068** — next free number. Lead with the privacy invariant and its three structural
  guarantees; then per-user OAuth as the repo's **first** (Slack is one bot token, and ADR 0067
  names that as its defining limitation, so this is a genuinely new pattern); token encryption;
  why no Drive read is cached; Picker instead of an uploader, and the full-Drive-token-in-browser
  concession that buys; denormalized pairs; the record-scoped gate with no matrix change; the
  create ordering with `files.delete` as an exact compensating action; the display-snapshot name;
  not seeded.
- **`docs/guides/google-drive.md`** — the runbook, following `docs/guides/slack.md`'s shape: the
  Cloud setup steps above, a scope → API-method → why table, the three env vars, **"everyone must
  sign out and back in once"** as a required step, a verification walkthrough, a troubleshooting
  table keyed on the exact user-visible error strings, the separate-dev-shared-drive convention,
  and a closing "what this deliberately does not do".
- **`docs/domains/drive.md`** — knowledge doc, framed like `docs/domains/slack.md`: not a sixth
  domain, a cross-domain integration CRM and Projects each own half of.
- Updates to `docs/architecture.md`, `docs/data-model.md`, `.env.example`,
  `docs/decisions/README.md`. `docs/domains/permissions.md` needs **no** change — verify that
  claim rather than assuming it.

Also worth flagging to the librarian: exploration found **existing drift** — ADR 0067 §5 and
`docs/domains/slack.md` describe a `disclosableSlackChannels` filter and an
`isConventionChannelName` predicate that do not exist in the code, and the code carries an
explicit counter-decision. Worth fixing in the same pass.

## Verification

Automated, and expected before claiming done:

- `bun run check` — Biome + `tsc --noEmit` + `bun test`. Must include the new
  `src/lib/drive/folder.test.ts` and a still-green `src/lib/auth/permissions.test.ts` (the matrix
  is unchanged, which is the point).
- `bun run build` — non-trivial change, so this is required, not optional.
- `bun run db:generate` must produce exactly one migration with 4 `ADD COLUMN`, 2
  `CREATE UNIQUE INDEX`, 2 `ADD CONSTRAINT … CHECK` and no backfill. Check `scripts/seed/` still
  compiles; it should need no change, since Drive is deliberately not seeded.
- `/audit-rbac` before calling the permissions work done, and `/code-review` before merging.

Runtime checks I can't run myself — **please run these and paste what you see** (I don't start the
app; `AGENTS.md`, _Never run the app_):

1. Sign out and back in. Confirm Google shows a Drive consent screen, and that
   `select refresh_token is not null, scope from account` shows a refresh token and the drive
   scope. This is the gate on everything else.
2. On a project, create a folder from the rail. Confirm it appears at
   `Lazer Home/Projects/<name>` in Drive, the rail links to it, and Drive shows **you** as the
   creator, not a service account.
3. Repeat on an opportunity → `Lazer Home/Sales/<name>`.
4. Try creating the same folder twice — expect the "already exists, link it instead" refusal, not
   a duplicate.
5. Files tab: browse, click into a subfolder, open a file in a new tab.
6. Add files → Upload tab: drop a file **larger than 10 MB**. It should succeed (this is the whole
   point of not building the uploader).
7. Add files → My Drive tab: pick a personal file. Confirm a **copy** lands in the folder and the
   original is still in your own Drive, unmoved.
8. Unlink, confirm the folder survives in Drive, and re-link it via search.
9. Have someone **without** Drive access to Lazer Home open the Files tab — expect the "no-access"
   notice, not a crash or an empty folder that reads as "no files".
10. Revoke the app in Google account settings, reload the Files tab, use the reconnect button.

## Out of scope

Nothing that isn't the folder link and the two tabs. Specifically: no in-app rename, delete, or
move of files; no folder rename sync when a project or opportunity is renamed (the stored name is
a display snapshot, exactly like the Slack channel name); no permission management on folders; no
reconciliation job for a folder deleted in Drive (the tab reports `no-access` and that's the whole
story); no carrying an opportunity's sales folder over to the project created from it (ADR 0067
§2 rejected the equivalent for Slack, and the same "many opportunities, one project, no
unambiguous owner" reasoning applies); no Drive activity in a feed or on a list view; and no
per-file records in our database — Drive stays the system of record for files, as Rippling does
for pay.
