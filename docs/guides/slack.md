# Setting up the Slack integration

This is the **runbook**: what to click, what to paste, how to check it worked. It is written to be
followed once per workspace by whoever has permission to install a Slack app.

For *why* any of it is shaped this way — the data model, the authorization gate, the caching — see
[`domains/slack.md`](../domains/slack.md) and [ADR 0067](../decisions/). Those explain the design;
this page just gets it running.

## What you get

Two channel slots, each managed only on its own record's page:

| Slot | Where | Name | Visibility |
| --- | --- | --- | --- |
| Scoping channel | Opportunity drawer → **Details** tab, bottom of the left rail | `l-scoping-<deal>` | **Private** |
| Project channel | `/projects/[id]` → sidebar, under Delivery managers | `l-project-<project>` | **Public** |

Each can create a new channel (inviting people you pick) or link one that already exists, and shows
the linked channel as a link out to Slack.

**Until you finish this setup the feature still appears** — anyone with `crm.edit` or `projects.edit`
sees the slot and a muted "Slack isn't connected". Nothing is hidden; it just can't do anything yet.

## 1. Create the Slack app

You need permission to install apps in the workspace. If you don't have it, someone with Workspace
Owner/Admin rights has to do this step or approve the install request at the end.

1. Go to <https://api.slack.com/apps> → **Create New App** → **From an app manifest**.
2. Pick the workspace.
3. Paste this manifest:

```yaml
display_information:
  name: Lazer Home
  description: Links Slack channels to opportunities and projects in Lazer Home
  background_color: "#4f46e5"
features:
  bot_user:
    display_name: Lazer Home
    always_online: false
oauth_config:
  scopes:
    bot:
      - channels:read
      - channels:manage
      - groups:read
      - groups:write
      - users:read.email
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

4. **Create**, then **Install to Workspace** and approve.

Slack's UI may silently add `users:read` alongside `users:read.email` — that's expected, leave it.

### What each scope is for

| Scope | Used by | Why |
| --- | --- | --- |
| `channels:read` | `conversations.list` | Find public channels to link or suggest |
| `groups:read` | `conversations.list` | Same, for private channels **the app is in** — see [§5](#5-existing-private-channels-need-an-invite) |
| `channels:manage` | `conversations.create`, `.invite`, `.archive` | Create the public project channel, invite people, and archive on the failure path |
| `groups:write` | Same, private | Create the private scoping channel, invite, archive |
| `users:read.email` | `users.lookupByEmail` | Turn a staff member's email into a Slack user id so they can be invited |

Nothing here can read messages, post messages, or see channel history. The app only creates channels,
lists them, and invites people.

> If invites specifically fail with `missing_scope` while creating works, add
> `channels:write.invites` and `groups:write.invites` and reinstall. Slack's own reference is
> inconsistent about whether `channels:manage`/`groups:write` cover inviting; the method-level docs
> say they do, and one scope page implies they don't. This is the one step where following the docs
> may not be enough.

## 2. Copy the bot token

**OAuth & Permissions** → **Bot User OAuth Token**. It starts with `xoxb-`.

Take the **Bot User** token, not the User token (`xoxp-`). The app refuses to boot on an `xoxp-`
token rather than failing later with an opaque permission error — see [§7](#7-troubleshooting).

## 3. Set the environment variables

In `.env`:

```bash
SLACK_BOT_TOKEN=xoxb-...
# Optional. Scopes the "open in Slack" links to one workspace, so someone signed
# into several doesn't land in the wrong one. Links work fine without it.
SLACK_TEAM_ID=T01234567
```

`SLACK_TEAM_ID` is the `T…` id in any Slack URL — open Slack in a browser and it's in the address bar.

Both are optional as far as the app is concerned: with neither set, the integration is simply off.

## 4. Restart the app

**Required.** `src/env.ts` parses the environment once at import, so a running dev server will not
pick up a token you just added.

## 5. Existing private channels need an invite

This is the one limitation worth understanding before you start using it, because it isn't a bug and
there's no way around it from our side.

**Slack only lets a bot see private channels it has been added to.** So:

- **Public** channels — the app sees all of them. Project-channel search and suggestions are complete.
- **Private** channels — the app sees only the ones it created, plus any it was explicitly invited to.

So to link a **pre-existing private scoping channel**, first run this in that channel:

```
/invite @Lazer Home
```

Then search for it again in the app. The channel list is cached for an hour, so if it still doesn't
appear immediately, it will shortly.

Creating a new scoping channel needs none of this — the app is a member of anything it creates.

### The flip side, worth telling the team

Because linking deliberately accepts **any** channel name (channels that predate the `l-scoping-`
convention are exactly the ones people need to link), the channel picker will show the *name* of any
private channel the app has been invited to, to anyone holding `crm.edit` or `projects.edit`.

That's bounded — a channel is invisible to the app until someone deliberately invites it — but it
makes one rule real: **don't invite this app to private channels whose existence is sensitive.**
It has no need to be in any channel it didn't create.

## 6. Check it works

1. Open an opportunity → **Details** tab → the **Scoping channel** row at the bottom of the left rail.
   The muted "Slack isn't connected" should be gone, leaving just **Create or link**.
2. Click it. The dialog shows the exact channel name it will create, read-only. Outside production it
   is prefixed `test-` (see [§8](#8-development-vs-production)).
3. Leave yourself in **Invite**, add someone else, and **Create channel**. The dialog closes and the
   row becomes a link. Click it — Slack should open on a **private** channel with both of you in it.
4. Open a project at `/projects/[id]` → sidebar → **Slack channel** → create. Confirm that one is
   **public**.
5. Try linking: in the dialog, search under *or link an existing channel*, pick one, **Link**.
6. Rename a record to match an existing channel and reopen it — a *"Found #…"* line should appear
   under the button, offering to link it in one click.

If a step misbehaves, the error text tells you which row of the next section you're in.

## 7. Troubleshooting

Errors are shown in the dialog (create/link) or as a toast (the one-click suggestion, unlink).

| What you see | What it means | Fix |
| --- | --- | --- |
| App won't boot: `SLACK_BOT_TOKEN must be a bot token (starts with 'xoxb-')` | A user token (`xoxp-`) was pasted | Use the **Bot User** OAuth token ([§2](#2-copy-the-bot-token)) |
| The Slack row isn't there at all | You lack `crm.edit` (opportunity) or `projects.edit` (project) | Expected — the row is hidden from people who can't use it |
| Muted "Slack isn't connected" under the button | No token, or the app wasn't restarted | [§3](#3-set-the-environment-variables) and [§4](#4-restart-the-app) |
| "Slack isn't connected — an admin needs to set SLACK_BOT_TOKEN." | Same, on clicking through | As above |
| "The Slack app is missing a permission — it needs reinstalling." | A scope is absent | Add the missing scope from [§1](#1-create-the-slack-app), then **reinstall** — adding a scope without reinstalling does nothing |
| "Your Slack workspace doesn't allow this app to create channels." | Workspace policy restricts channel creation | A Workspace Admin has to permit it, or create the channel by hand and **link** it instead |
| "The Slack connection needs reconnecting." | Token revoked, or the app was uninstalled | Reinstall and set the new token |
| "#… already exists in Slack — link it instead." | A channel of that name is already there | Use the *link an existing channel* half of the same dialog. The name is derived from the record and isn't editable, so this is the intended route |
| "N people couldn't be found on Slack." | Their `staff.email` doesn't match a Slack account | The channel was still created. Check the address on their staff profile, or invite them in Slack |
| "N people couldn't be added — invite them in Slack." | Slack refused those invites | Invite them manually. If it's everyone, suspect the invite scopes ([§1](#1-create-the-slack-app)) |
| Channel search finds nothing | Blank query (by design), or a private channel the app isn't in | Type at least one character; for private channels see [§5](#5-existing-private-channels-need-an-invite) |
| "We can't find that channel in Slack any more." | Archived, or the app was removed from it | Unlink and pick another |
| "That Slack channel is already linked to another record." | One channel, one record | Unlink it from the other record first |
| A newly created channel doesn't show up in search | The channel list is cached for an hour | Creating busts the cache automatically; if you made it in Slack directly, wait it out |

## 8. Development vs production

**Channels created outside production are prefixed `test-`** — `test-l-scoping-acme` rather than
`l-scoping-acme`. This is automatic, driven by `NODE_ENV`, and the dialog's preview shows it, so you
always see what you're about to make.

- It applies to **creating only**. Linking never adds or requires the prefix.
- Suggestion matching ignores it, so a `test-` channel is still offered back for its own record.
- Sweep up afterwards by searching `test-l-` in Slack and archiving.

If you want dev to be genuinely harmless, point `SLACK_BOT_TOKEN` at a **separate scratch workspace**
rather than the real one. The `test-` prefix keeps things identifiable; a different workspace keeps
them out entirely.

## What this integration deliberately does not do

So nobody goes looking for it:

- Post messages or notifications of any kind.
- Read messages or channel history.
- Respond to slash commands or Slack events (there is no webhook endpoint).
- Archive a channel when a project closes.
- Track renames — the stored channel name is a display snapshot, and links are by channel id, so a
  rename never breaks a link but the app will keep showing the old name.
- Per-user Slack accounts. One bot token serves everyone; there is no "connect your Slack" flow.

Unlinking clears the link on our side only. It never touches the channel, its history, or its members.
