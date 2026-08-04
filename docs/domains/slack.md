# Domain: Slack channels

**Status: built (one slice).** Two kinds of Slack channel are linked to PSA records — a **private
scoping channel** on an opportunity and a **public project channel** on a project — with create /
link / unlink and an inline "we found this one" suggestion. Nothing else about Slack exists: no
messages, no notifications, no webhooks, no user-facing Slack identity.

This is not a fifth business domain; it's a **cross-domain integration** that CRM and Projects each
own half of. It gets its own doc because neither [crm.md](./crm.md) nor [projects.md](./projects.md)
owns the shared machinery, which is the same reason `src/lib/slack/` exists at all
([ADR 0036](../decisions/0036-lib-organized-by-domain-subfolders.md)). Full rationale:
[ADR 0066](../decisions/0066-slack-channel-links-bot-token-denormalized-pairs-and-record-scoped-gate.md).

## The two kinds

| Kind | Channel name | Visibility | Stored on | Managed at | Capability |
|---|---|---|---|---|---|
| `scoping` | `l-scoping-<slug>` | **private** | `opportunities.scopingSlackChannelId` + `…Name` | the opportunity detail drawer (Details tab, below the meta fields) | `crm.edit` |
| `project` | `l-project-<slug>` | **public** | `projects.slackChannelId` + `…Name` | `/projects/[id]` sidebar | `projects.edit` |

`<slug>` is the record's own name, slugified (`src/lib/slack/channel.ts`). The **dialog previews the
exact name the action will create**, because both call the same pure `buildSlackChannelName` — the
80-char cap is budgeted against the prefix, a trailing hyphen from the cut is trimmed, accents are
folded (`"Café Group"` → `cafe-group`), and a name with nothing sluggable (`"★"`, `"(TBD)"`) falls
back to the record's CUID2 id rather than emitting a bare `l-scoping-`.

**Each record manages only the channel that lives on it.** The opportunity drawer does *not* reach
across to the linked project's channel: a project can be built from several opportunities, so there'd
be no unambiguous owner for the control, and a sales-only user would face a permanently disabled
button. **Creating a project does not carry the scoping channel over** either — different visibility,
different members.

## The limitation to know before anything else

**Our Slack app can only see private channels it has been added to** (`groups:read`). So the
workspace listing is **complete for public channels and structurally partial for private ones** —
i.e. partial for exactly the scoping kind.

Consequences, all of them visible to users:

- A **pre-existing** scoping channel must be `/invite`d to the app before it can be found, linked or
  suggested. The create dialog says so inline, **only on the private path**, naming both conditions
  ("added to" *and* "named `l-scoping-…`").
- A **non-conventionally-named private channel can't be linked at all** until it's renamed — that's
  the disclosure filter below, not a bug.
- A channel we **create** is fine: the app is a member by construction.

Per-user OAuth is the named upgrade path if this ever becomes intolerable; it was rejected as far too
much machinery for writing two columns and opening a URL
([ADR 0066 §1](../decisions/0066-slack-channel-links-bot-token-denormalized-pairs-and-record-scoped-gate.md)).

## Slack app setup

> **The step-by-step runbook is [`guides/slack.md`](../guides/slack.md)** — the manifest to paste, the
> click path, verification steps and a troubleshooting table keyed on the actual error strings. Keep
> procedure there and rationale here; if the two disagree, the guide is the one people follow, so fix
> it first.

The integration authenticates as **one bot, installed once to the workspace**. There is no per-user
connect flow.

1. Create a Slack app for the workspace (from scratch is fine — no manifest is checked in).
2. Give the **bot token** these OAuth scopes:
   - `channels:read` — list public channels
   - `groups:read` — list the private channels the app is in
   - `channels:manage` — create/archive public channels
   - `groups:write` — create/archive private channels
   - `users:read.email` — resolve `staff.email` → Slack user id, for invites
3. Install to the workspace and copy the **Bot User OAuth Token** into `SLACK_BOT_TOKEN`. It starts
   with `xoxb-`; `src/env.ts` refines that prefix so the classic "pasted a *user* token" mistake
   fails at boot instead of surfacing as an opaque `missing_scope` on the first create.
4. Optionally set `SLACK_TEAM_ID` (findable in any Slack URL). It scopes the deep links to one
   workspace, so someone signed into several doesn't land in the wrong one. Links work without it.
5. **For any private channel that already exists and should be linkable:** `/invite` the app to it in
   Slack. There is no way around this from our side.

Both vars are **optional**. Absent `SLACK_BOT_TOKEN` the feature is off (see *Feature flag* below).

## Authorization — no capability was added

The gate is an **`ActionAuthorize` hook**, `authorizeSlackChannel`, on all five actions: it parses
`kind` off the raw `clientInput` and requires the capability that belongs to **the record being
written** — `crm.edit` for `scoping`, `projects.edit` for `project`.

**Why a hook rather than `metadata.permission`:** those two capabilities are **disjoint** in the
matrix (`sales` holds only `crm.edit`, `delivery-manager` only `projects.edit`), so any single static
capability would either lock out one audience or grant one of them the other domain. Because the hook
reuses existing capabilities, **`permissions.ts`, `permissions.test.ts` and
[permissions.md](./permissions.md)'s matrix are all untouched** — ADR 0014's lockstep rule is not
engaged, and it should stay that way. A `slack.manage` capability would be a third spelling of "may
edit this record".

Two things keep it a real gate:

- **An unparseable `kind` is denied, not skipped.** A hook that bails out when it can't read its own
  discriminant leaves the body running ungated.
- **`SLACK_CHANNEL_TARGETS` (`src/actions/slack/slackChannelLink.ts`) is the only place a kind maps
  to a table, a column pair, a capability and a revalidation.** The hook and every action body read
  the same entry, so "the hook checked `crm.edit` but the body wrote `projects`" is unrepresentable.
  Don't add a second source for any of those four facts.

`searchSlackChannelsSchema.kind` is `nullish` purely to satisfy the generic `SearchAction` contract
(the same shape `searchProjects` uses for `companyId`). That does **not** weaken the gate — the hook
has already refused anything without a valid kind.

### The private-channel disclosure filter

`disclosableSlackChannels` (`getSlackChannels.ts`) is applied by search, suggestions **and
`linkSlackChannel`** — including the write path, so an id pasted for an unrelated private channel
can't be linked (and its name echoed back) just because our bot happens to be in it.

- **Public channels pass through untouched** — every employee can already browse them in Slack, so
  surfacing them behind `crm.edit`/`projects.edit` is *narrower* than the status quo.
- **Private channels are restricted to the naming convention.** A private channel's name is invisible
  to non-members in Slack, and the bot may have been invited to an HR or exec channel for something
  unrelated; without this, the picker would quietly become a way to **enumerate those names**.

Search is deliberately **not** filtered to the kind's own visibility — a scoping channel mistakenly
created public can still be linked. `SLACK_CHANNEL_IS_PRIVATE` governs what we *create*.

## What each action does

All five live in `src/actions/slack/` and share the gate above.

- **`createSlackChannel`** — creates in Slack and links. **The step order is the design**, because
  the create is not transactional with our write and Slack has **no `conversations.delete`**:
  reject-if-linked → build name → collision precheck against the cached listing (so the common case
  gets "link it instead" rather than Slack's `name_taken`) → **resolve invitees** (the flakiest,
  highest-fan-out step, moved *before* the irreversible call) → `conversations.create` → persist under
  an `isNull` guard → **on persist failure, `conversations.archive` as the compensating action**
  (safe *precisely because nobody has been invited yet*) + a `slack_channel_orphaned` error log →
  **invites last, best-effort**, returning a `warnings` array. The client sends **staff ids, never
  emails** — emails are read server-side from `staff.email`, so a caller can't invite an arbitrary
  address. The **stored name is the one Slack returns**, since it normalises on create.
- **`linkSlackChannel`** — points a record at an existing channel. Takes the channel **id only**; the
  name is resolved server-side from the listing, so a client can't make the displayed name disagree
  with the channel. **Never joins and never invites** (`conversations.invite` requires membership, and
  inserting our bot into someone's private channel isn't ours to do).
- **`unlinkSlackChannel`** — clears the two columns and **nothing else**. The channel, its history and
  its members are untouched, which is what the confirmation copy promises. In scope from day one
  because it's the only escape hatch for the three ways a link goes bad: wrong channel linked, channel
  archived in Slack, or the bot removed from it.
- **`searchSlackChannels`** — type-ahead, `SearchAction`-shaped so it drops into `EntityCombobox`.
  Filters **in memory** over the cached listing (Slack has no bot-usable channel-search endpoint),
  blank query returns nothing, shortest name first, already-linked channels dropped.
- **`suggestSlackChannel`** — one record, one suggestion. See below.

## The suggestion

When a slot is empty and the viewer could fill it, the field asks Slack whether a similarly-named
channel already exists and offers it for one-click linking.

- **It's a client-triggered read, deliberately not part of the detail payload.** A cold channel-list
  cache costs several sequential Slack round-trips, and neither the opportunity drawer nor the project
  page should wait on Slack to render. The **stored link is on the detail payload for free** (both
  columns are already on the row being read — no extra query, no join); only the suggestion needs the
  network, and it fires after render.
- **Strictly one record per call. Never wire it into a list or the kanban**, where it would fan out
  into a Slack round-trip per card.
- Matching is **Sørensen–Dice over character bigrams with the convention prefix stripped from both
  names first** — that stripping is the whole trick, since `l-project-acme` and `l-project-zeta`
  otherwise share ten leading characters and every project channel scores as a decent match for every
  other. When one slug wholly **contains** the other (the "we shortened it" case) Dice under-scores
  it, so the result is floored at `0.7` — the same value as the propose-it threshold, set so a
  substring match clears it and a merely-similar name doesn't. **A wrong suggestion is worse than
  none**, since acting on it links the wrong channel.
- Dismissal is component state, not persisted — it's a quiet line in an already-empty field, so
  re-offering it after a reopen costs nothing (and persisting per-browser would mean dismissing on a
  laptop and seeing it again on a desktop).

## Storage

Two nullable `text` columns per owning table, plus:

- a **named `uniqueIndex`** per table (`opportunities_scoping_slack_channel_idx`,
  `projects_slack_channel_idx`) — one channel, at most one record of that kind. Plain, not partial:
  Postgres treats NULLs as distinct, so the unlinked majority is unconstrained. Named so
  `isUniqueViolation` can key off it;
- a **`check`** per table (`…_slack_channel_shape`) enforcing **both null or both set**, so a
  half-written link is unrepresentable — the same call as `projects_budget_shape`. All-null rows
  satisfy it, so `drizzle/0024_wide_marten_broadcloak.sql` **needed no backfill**.

**No `slack_channel_links` table**, deliberately: both relationships are 1:1, and a polymorphic table
needs an untyped `recordId` with no FK — losing the cascade that drops the link for free when the deal
or project is deleted — plus a join on every detail read.

**Cross-kind uniqueness is a UX rule, not a DB invariant.** The same channel sitting on an opportunity
*and* a project is prevented in `linkSlackChannel` and hidden from search/suggestions by
`channelIdsAlreadyLinked` (two indexed `IN` lookups over a **candidate shortlist**, so it doesn't grow
with the number of records). Not a constraint — it spans two tables and isn't a truth about the data.

**The stored name is a display snapshot.** Every link is by **id**, so a rename in Slack never breaks
the hyperlink; it only makes the label stale. Nothing writes the name back from a read — that would
turn every detail render into a Slack call. `toSlackChannelRef` is the one place a stored pair becomes
UI shape, and it builds the `slack.com/app_redirect?channel=…&team=…` deep link **server-side** so
`SLACK_TEAM_ID` never ships to a client.

## Feature flag

`isSlackConfigured()` is a cheap synchronous env read, passed to the UI as `slackEnabled` —
on the opportunity drawer's **envelope** (`OpportunityDrawerData`), not on `OpportunityDetail`,
because it describes the *environment*, not the opportunity (the same reason `currentStaff` sits
there), and as a prop to `ProjectDetailView`.

`SlackChannelField` resolves **five** cases. The axis that decides whether the row appears at all is
not the token — it's **whether this viewer could act on it**:

| # | Channel | Token | `canManage` | Renders |
|---|---|---|---|---|
| 1 | linked | either | either | the Slack hyperlink (unlink offered with `canManage`) |
| 2 | — | set | yes | "Create or link" + the suggestion line |
| 3 | — | set | no | muted "Not linked" |
| 4 | — | **absent** | **yes** | muted **"Slack isn't connected"** |
| 5 | — | absent | no | **nothing — the row is hidden** |

i.e. `if (!enabled && !channel && !canManage) return null`, with case 4 reachable *only* because of
that early return. **Read the guard and the case-4 branch together** — changing one without the other
silently re-hides or double-renders the row.

**Case 1 is unconditional:** an already-stored link renders with or without a token, since
`app_redirect` is just a URL and needs no bot; dropping it because a token was removed would lose
information for nothing. **Unlink still works** there too — it's app-side only.

**Why case 4 exists (it reverses the first cut).** The row originally hid itself from *everyone*
without a token, on the argument that "Slack isn't configured" is admin-facing noise on a sales
surface. That still holds for an arbitrary viewer — hence case 5 — but it was the wrong weighting for
someone holding the capability: **an invisible feature can't be discovered, adopted or debugged**, so
the one person whose job it'd be to connect Slack was the one person certain never to learn the slot
existed. Gating the hide on `canManage` satisfies both concerns. Case 4 is deliberately **inert, not
disabled-with-a-tooltip** — there's nothing to click, and the fix is an env var, not an in-app
action. See [ADR 0066 §10](../decisions/0066-slack-channel-links-bot-token-denormalized-pairs-and-record-scoped-gate.md)
(amended).

## Transport + caching

`slackApi.ts` is two functions, not an SDK — the [ADR 0029](../decisions/0029-external-fx-rates-and-currency-normalization.md)
pattern (bare `fetch`, Zod at the trust boundary, no vendor client), extended here to the first
*authenticated* external service. Two Slack-specific traps it exists to close:

- **`res.ok` is not success.** Slack answers HTTP 200 with `{ ok: false, error }` for most failures,
  including rate limiting. Both shapes of rate limiting are handled (a real 429 with `Retry-After`,
  and a 200 whose body says `ratelimited`).
- **A bare `fetch` has no timeout.** Every request carries a 10s `AbortSignal.timeout`, or a hung
  Slack connection hangs the server action holding it.

`SlackApiError` carries Slack's own machine-readable code, so each action maps the handful it has real
copy for (`name_taken`, `missing_scope`, `restricted_action`, `invalid_auth`/`token_revoked`,
`ratelimited`) and everything else falls through to a generic message. An `invalid_name*` code is
logged as an **error**, not shown as a user mistake — it's unreachable if `buildSlackChannelName` is
right, so it's a bug signal.

Caching — **the repo's first Next cache tags**:

- `SLACK_CHANNELS_TAG` (1h) on `conversations.list`, `SLACK_USERS_TAG` (6h) on
  `users.lookupByEmail`. Both are **GET**s; every write is POST + `cache: "no-store"`.
- **Authenticated `fetch` does cache here.** Next normally refuses to cache a request with an
  `Authorization` header, but `patch-fetch.js` only applies `autoNoCache` when there is **no explicit
  cache config** — an explicit `next: { revalidate, tags }` wins. Verified, not assumed.
- After a create: **`updateTag`, not `revalidateTag`.** In this Next build the single-arg
  `revalidateTag` is deprecated and the two-arg form is stale-while-revalidate — which would keep
  serving a channel list *without the channel just created*, so the collision precheck and search
  would both lie. `updateTag` is immediate-expiry / read-your-own-writes, Server-Actions-only.
  `linkSlackChannel`/`unlinkSlackChannel` deliberately **don't** call it: nothing changed in Slack.
- `getSlackChannels` **never throws** (the ADR 0029 rule — it's on the render path of two detail
  surfaces). It returns `{ configured, degraded, channels }`, degrading to a partial list on a failed
  page or the 5-page cap (~1000 channels). **Callers must not read "not in this list" as "does not
  exist"** — the cost is a missed suggestion, and Slack's own `name_taken` is the real guard.

## Not seeded, deliberately

`scripts/seed/` is untouched: the columns are nullable so nothing is required, and a fake `C…` id
would render a hyperlink that **errors inside Slack** while leaving the empty-state, dialog and
suggestion paths — the parts with logic — never exercised in dev. An unset `SLACK_BOT_TOKEN` locally
exercises the off state instead, which is the honest local situation.

## Where the code is

- `src/lib/slack/channel.ts` (+ `.test.ts`) — pure, client-importable: kinds, prefixes, visibility,
  the name builder, `isConventionChannelName`, `slackChannelUrl`, `formatSlackChannel`,
  `scoreSlackChannelMatch` + threshold, `SlackChannelRef`.
- `src/actions/slack/` — `slackApi.ts` · `getSlackChannels.ts` (+ `disclosableSlackChannels`) ·
  `slackUsers.ts` · `slackChannelLink.ts` (`SLACK_CHANNEL_TARGETS`, `channelIdsAlreadyLinked`) ·
  `authorizeSlackChannel.ts` · `slackChannel.schema.ts` (pure, client-imported —
  [ADR 0035](../decisions/0035-schema-modules-by-import-boundary.md)) · `slackChannelRef.ts` · the
  five actions.
- `src/components/slack/` — `slack-channel-field.tsx` (the one slot both surfaces mount),
  `slack-channel-dialog.tsx` (create *and* link in one dialog, create first), and
  `slack-channel-suggestion.tsx` (deliberately **not** an `InlineNotice` — that component's tones read
  as *FYI* or *problem*, while this is an affordance).
- Extended reads: `crm/getOpportunity.ts` (`slack`, scoping only) · `crm/loadOpportunityDetail.ts`
  (`slackEnabled` on the envelope) · `projects/getProjectPlan.ts` (`slack` as a **sibling** of
  `project`, not on `PlanProject` — that type is shared with `getOpportunityPlan`).
- Env: `SLACK_BOT_TOKEN` (`xoxb-` refine) + `SLACK_TEAM_ID` in `src/env.ts`, documented in
  `.env.example`.

## Open questions / not built

- **No messages, notifications or webhooks.** Nothing is ever posted into a channel — not on
  creation, not on a stage change. The integration reads channel metadata and writes two columns.
- **No archive-on-close.** Nothing archives a channel when a deal is lost or a project ends; unlink
  is the only app-side action, and it leaves Slack alone.
- **No rename sync.** A renamed channel keeps the stale stored label until someone unlinks and
  relinks (the hyperlink itself never breaks).
- **No reconciliation for an orphaned channel** — if `conversations.create` succeeds and both the
  persist *and* the compensating archive fail, the log names the channel and the user is told to try
  again. There's no job that finds it later.
- **No per-user Slack identity.** `staff.email` → Slack user id is resolved on demand for invites and
  never stored; a person with no Slack account is reported as a warning, not a failure.
- **Private-channel discovery** stays incomplete until (if ever) per-user OAuth replaces the bot token.
