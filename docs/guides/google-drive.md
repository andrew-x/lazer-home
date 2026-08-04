# Setting up the Google Drive integration

This is the **runbook**: what to click, what to paste, how to check it worked. It is written to be
followed once per environment by whoever can administer the Google Cloud project and the shared
drive.

For *why* any of it is shaped this way — the privacy invariant, why every call runs as the signed-in
person, why nothing is cached — see [`domains/drive.md`](../domains/drive.md) and
[ADR 0069](../decisions/0069-google-drive-folder-links-per-user-oauth-and-the-privacy-invariant.md).
This page just gets it running.

> **Step 5 blocks everything and catches everyone out: after this change, every existing user must
> sign out and back in once.** Adding the Drive scope grants nothing retroactively. Read
> [§5](#5-everyone-signs-out-and-back-in-once-required) before you tell anyone the feature is live.

## What you get

Two folder slots, each managed only on its own record's surface, plus a **Files** tab on each:

| Slot | Where | Folder |
| --- | --- | --- |
| Sales folder | Opportunity drawer → **Details** tab, bottom of the left rail | `Lazer Home/Sales/<deal name>` |
| Project folder | `/projects/[id]` → sidebar, under the Slack row | `Lazer Home/Projects/<project name>` |

Each can create the folder or link one that already exists, and links out to it. The **Files** tab on
each surface browses the folder (into subfolders), opens files in Drive, and adds files two ways:
**Upload** (Google's own uploader writes straight into the folder) and **From my Drive** (picks a file
you own and **copies** it in — the original never moves).

**Until you finish this setup the feature still appears** — anyone with `crm.edit` or `projects.edit`
sees the slot and a muted "Google Drive isn't connected". Nothing is hidden; it just can't do anything
yet.

## 1. Enable the two APIs

Use the **same Google Cloud project as the existing OAuth client** (the one behind
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) — the Picker's app id is that project's number, so a
second project won't work.

In **APIs & Services → Library**, enable both:

- **Google Drive API** — every server-side call (`files.list`, `files.create`, `files.copy`,
  `files.delete`).
- **Google Picker API** — the browser-side file chooser. Easy to miss, and its absence surfaces only
  as "Couldn't open the Google Drive picker."

## 2. Keep the consent screen Internal, and add the scope

**APIs & Services → OAuth consent screen** must be **Internal** (User type: Internal). This is
load-bearing, not a default we happen to have: `https://www.googleapis.com/auth/drive` is a
**restricted** scope, and Internal is what permits it **with no Google verification and no CASA
security assessment**. Switching the consent screen to External would put the app into a verification
queue and break sign-in for everyone in the meantime.

Then add the scope to the OAuth client's configured scopes:

```
https://www.googleapis.com/auth/drive
```

### What the scope is for

| Scope | Used by | Why |
| --- | --- | --- |
| `https://www.googleapis.com/auth/drive` | `files.list` | Browse the shared drive and search it for folders to link |
| | `files.create` | Create a record's folder (and the `Sales`/`Projects` parents on first use) |
| | `files.copy` | Copy a file you picked in the Picker into the folder |
| | `files.delete` | Only ever used to undo a folder we just created when the DB link failed |
| | `files.get` | Read a folder/file's name and confirm it lives in the shared drive |

**Why not the narrower `drive.file`:** it grants per-file access only, so a file a colleague added
through Drive's own UI would be invisible to us and the Files tab would silently show a subset of the
folder. See [ADR 0069 §3](../decisions/0069-google-drive-folder-links-per-user-oauth-and-the-privacy-invariant.md).

**What the app never does with this scope:** it never lists, searches or enumerates anyone's personal
Drive. Every listing is hardcoded to the one shared drive; the only path that touches a personal file
is a copy of a file you picked yourself. That is enforced in code, not by policy —
[ADR 0069 §1](../decisions/0069-google-drive-folder-links-per-user-oauth-and-the-privacy-invariant.md).

## 3. Create a Picker API key and note the project number

1. **APIs & Services → Credentials → Create credentials → API key.**
2. **Restrict it** (Edit the key → API restrictions → Restrict key → **Google Picker API**). Also add
   an HTTP-referrer restriction for your app's origins if you want belt and braces.
3. Copy it → `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY`.
4. From the Cloud console's project picker (or **IAM & Admin → Settings**), copy the **project
   number** — the numeric one, not the project *id* → `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID`.

Both of these are `NEXT_PUBLIC_*` and ship to the browser **by design**: the Picker runs client-side
and neither value is a secret. Restricting the key is what keeps it from being useful elsewhere.

## 4. Copy the shared drive id

Open the **Lazer Home** shared drive in Drive and take the id from the URL:

```
https://drive.google.com/drive/folders/0ABcDeFgHiJkLmNoPQ
                                       ^^^^^^^^^^^^^^^^^^  → GOOGLE_DRIVE_ROOT_ID
```

Then set all three variables in `.env`:

```bash
# All three, or the feature stays off.
GOOGLE_DRIVE_ROOT_ID=0ABcDeFgHiJkLmNoPQ
NEXT_PUBLIC_GOOGLE_PICKER_API_KEY=AIza...
NEXT_PUBLIC_GOOGLE_PICKER_APP_ID=123456789012
```

`isDriveConfigured()` requires **all three**. That is deliberate: browsing needs only the drive id,
but the Picker needs its own two, and a half-configured install where files list yet nothing can be
added is worse than a feature that is plainly off.

**Restart the app.** `src/env.ts` parses the environment once at import, so a running dev server will
not pick up variables you just added.

You do **not** need to create `Sales` or `Projects` inside the shared drive — the app creates them by
name on first use.

## 5. Everyone signs out and back in once (required)

**This is the step that will otherwise waste an afternoon.** Adding the Drive scope to the OAuth
client changes what *future* logins ask for. It grants nothing to sessions that already exist, so
until each person re-consents, their Files tab shows *"Your Google account needs to grant Drive
access before files show up here."*

Two equivalent fixes, per person:

- **Sign out and back in.** Google shows a Drive consent screen; approve it.
- **Press "Reconnect Google Drive"** on the notice in the Files tab. This uses incremental consent, so
  it *adds* Drive to the existing grant and **does not** end the session — nobody loses their place in
  the app.

The same reconnect path is the fix if someone later revokes the app in their Google account settings.

To confirm a real grant landed, against the app's database:

```sql
select "refreshToken" is not null as has_refresh, scope
from account where "providerId" = 'google';
```

You want `has_refresh = true` **and** `.../auth/drive` in `scope`. Note two things while reading it:
Better Auth stores `scope` **comma**-joined, not space-joined, and with token encryption on the token
columns are ciphertext — that's expected.

**Why a refresh token matters:** without one, Drive works for about an hour after each login and then
silently stops (the app detects this and asks for a reconnect rather than showing an opaque error).
`accessType: "offline"` + `prompt: "…consent"` in the auth config are what make Google issue it.

## 6. Check it works

Sign out and back in first (§5), then:

1. Open a project at `/projects/[id]` → sidebar → **Drive folder**. The muted "Google Drive isn't
   connected" should be gone, leaving just **Create or link**.
2. Click it. The dialog previews the exact path — `Lazer Home / Projects / <name>` — read-only.
   **Create folder.**
3. Check Drive: the folder exists at that path, and Drive shows **you** as the creator (not a service
   account). The sidebar row is now a link to it.
4. Repeat on an opportunity → the folder lands under `Lazer Home / Sales / <deal name>`.
5. **Try creating the same folder twice.** Expect a refusal — *"A folder called … already exists in
   Projects — link it instead of creating another."* — not a duplicate.
6. **Files** tab → browse. Click into a subfolder (the breadcrumb walks back), and open a file: it
   opens in Drive in a new tab.
7. **Upload** → drop a file **larger than 10 MB**. It should succeed; Google's uploader is doing the
   work, which is the whole point of not building our own.
8. **From my Drive** → pick a file you own. A **copy** appears in the folder, and the original is
   still in your own Drive, unmoved.
9. **Unlink** from the sidebar. The folder survives in Drive with all its files; only the link is
   cleared. Re-link it by typing its name in the dialog's search box.
10. Have someone **without** access to the Lazer Home shared drive open the Files tab. Expect the
    "you do not have access to this folder" notice — not a crash, and not an empty folder that reads
    as "no files".

If a step misbehaves, the error text tells you which row of the next section you're in.

## 7. Troubleshooting

Errors appear in the dialog (create/link), as a toast (unlink, add files), or as a notice inside the
Files tab.

| What you see | What it means | Fix |
| --- | --- | --- |
| Muted "Google Drive isn't connected" under the button | One or more of the three env vars is unset, or the app wasn't restarted | [§4](#4-copy-the-shared-drive-id) |
| "Google Drive isn't connected." on clicking through | Same, on the server side | As above |
| The Drive row isn't there at all | You lack `crm.edit` (opportunity) or `projects.edit` (project) | Expected — the row is hidden from people who couldn't act on it |
| "Your Google account needs to grant Drive access before files show up here." | Your grant predates the scope, or your refresh token stopped working | Press **Reconnect Google Drive**, or sign out and back in ([§5](#5-everyone-signs-out-and-back-in-once-required)) |
| "Reconnect your Google account to use Drive." | The same state, hit on a write | As above |
| "You do not have access to this folder in Google Drive." | You aren't a member of the Lazer Home shared drive, **or** the folder was deleted in Drive | Ask to be added to the shared drive; if it was deleted, unlink and link/create another |
| "You don't have permission to add folders to the Lazer Home shared drive." | You're a Viewer/Commenter on the shared drive | A drive manager has to give you Contributor or above |
| "The Lazer Home shared drive isn't reachable. Ask an admin to check the Drive setup." | `GOOGLE_DRIVE_ROOT_ID` is wrong, or points at a drive the signer-in can't see | Re-copy the id from the drive's URL ([§4](#4-copy-the-shared-drive-id)); the server logs `drive_root_not_found` |
| "A folder called … already exists in Projects — link it instead of creating another." | A folder of that name is already under the parent | Use the *link an existing folder* half of the same dialog. The name comes from the record and isn't editable, so this is the intended route |
| "That folder is already linked to another record." | One folder, one record (and that spans both kinds) | Unlink it from the other record first |
| "Pick a folder inside the Lazer Home shared drive so everyone can reach it." | The linked id is a folder in someone's personal Drive | Move/create it in the shared drive — a personal folder nobody else can open would be a useless link |
| "That's a file, not a folder." | The linked id is a file | Pick a folder |
| "The owner of that file has disabled copying. Ask them to share it another way." | The source file has *"viewers cannot copy"* set | Only its owner can lift that; ask them, or download-and-upload via the **Upload** button |
| "Folders can't be copied in here — add the files inside it instead." | You picked a folder in the "From my Drive" Picker | Pick files |
| "The shared drive is out of space. Ask an admin to free some up." | Shared-drive storage quota exhausted | A Workspace admin's job |
| "Couldn't open the Google Drive picker." | The **Picker API** isn't enabled, the API key is missing/over-restricted, or `apis.google.com` is blocked | [§1](#1-enable-the-two-apis) and [§3](#3-create-a-picker-api-key-and-note-the-project-number) |
| "Google Drive isn't fully configured." on opening the Picker | One of the two `NEXT_PUBLIC_*` values is unset | [§3](#3-create-a-picker-api-key-and-note-the-project-number) |
| "Google Drive did not respond. Try again in a moment." | Timeout, 5xx, or rate limit | Wait; every call has a 10s timeout by design |
| "This folder holds more files than we can list here." | Over 1000 direct children — the app fetches one page and says so rather than showing a partial list as complete | Open it in Drive; there's no in-app paging |
| Folder search finds nothing | Blank query (by design), or the folder is already linked to another record | Type at least one character; already-linked folders are hidden so the picker can't offer one that would be refused |
| A folder created directly in Drive doesn't show in search | Nothing is cached here, so this shouldn't happen | Check you're looking in the **same** shared drive as `GOOGLE_DRIVE_ROOT_ID` (dev usually points elsewhere — [§8](#8-development-vs-production)) |

## 8. Development vs production

**Point dev at a separate shared drive.** Create a scratch shared drive, share it with whoever needs
it, and set `GOOGLE_DRIVE_ROOT_ID` to its id.

This is why there is **no `test-` name prefix** on created folders, unlike the Slack integration: a
Slack workspace is singular, so dev and prod share one and channels need a marker to tell them apart.
A shared drive isn't — a separate drive keeps test folders out entirely rather than merely
identifiable.

The API key, the app id and the OAuth client can be shared between environments; only the drive id
should differ. Leaving all three unset locally is a perfectly good default — the Drive controls simply
show themselves as not connected, which is the honest local state.

## What this integration deliberately does not do

So nobody goes looking for it:

- **Rename, delete or move files** from inside the app. The Files tab lists and adds; everything else
  is Drive's job, one click away.
- **Rename the folder when a record is renamed.** The stored folder name is a display snapshot and
  links are by folder id, so a rename never breaks the link — the app just keeps showing the old name
  until someone unlinks and relinks.
- **Manage folder permissions.** Who can see a folder is Drive's shared-drive membership, unchanged by
  anything here.
- **Notice a folder deleted in Drive.** The Files tab reports "you do not have access", and unlink is
  the fix. There is no reconciliation job.
- **Carry an opportunity's sales folder over to the project created from it.** Several opportunities
  can feed one project, so there'd be no unambiguous owner.
- **Keep any record of individual files.** Drive stays the system of record; nothing is mirrored into
  our database, and no file contents ever pass through our server.
- **Cache anything.** Every Drive read happens live, as you, on your own token — see
  [ADR 0069 §4](../decisions/0069-google-drive-folder-links-per-user-oauth-and-the-privacy-invariant.md).

Unlinking clears the link on our side only. It never touches the folder or the files in it.
