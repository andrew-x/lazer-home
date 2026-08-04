# 0066 — Slack channel links: one workspace bot token, denormalized column pairs, and a record-scoped `authorize` gate

**Status:** accepted · 2026-08-04 · **§10 amended the same day** — the feature-off row is hidden only
from viewers *without* the managing capability, reversing "hide it from everyone" (an invisible
feature can't be adopted or debugged by the person who'd connect it) · **extends [ADR 0029](./0029-external-fx-rates-and-currency-normalization.md)**
(which set the outbound-HTTP pattern with a deliberately *keyless* API and deferred secret
management) to the **first secret-bearing integration** · `src/lib/slack/` is justified under
[ADR 0036](./0036-lib-organized-by-domain-subfolders.md) the same way `format/fx.ts` is · the
gate is [ADR 0014](./0014-rbac-better-auth-access-control.md)'s `ActionAuthorize` hook, so
**no capability and no matrix change** (the lockstep rule is not engaged) · the repo's **first
Next cache tags** · migration `drizzle/0024_wide_marten_broadcloak.sql`

## Context

Deals and engagements are actually run in Slack: a **private scoping channel** while a deal is
being priced, a **public project channel** once it's being delivered. Neither was recorded
anywhere, so finding the channel for a project meant guessing at Slack's own search, and creating
one meant remembering the naming convention by hand (`l-scoping-…` / `l-project-…`) and inviting
people one at a time.

We wanted the PSA record to carry the channel: a link out from the opportunity drawer and the
project page, and a one-click way to *create* the conventionally-named channel and invite the
people already on the record. That pulled in a set of decisions that have nothing to do with each
other except that all of them are load-bearing: **which Slack credential** (which decides what the
feature can *see*), **how a link is stored**, **which capability guards it** given the two kinds
live in two domains with disjoint capabilities, **what a channel picker is allowed to name back to
a user**, and **what happens when Slack succeeds and our DB doesn't**.

## Decision

### 1. One workspace bot token, no per-user OAuth

The integration authenticates as a **single Slack app installed once to the workspace**
(`SLACK_BOT_TOKEN`, refined in `src/env.ts` to start with `xoxb-` so the classic "pasted a user
token" mistake fails at boot rather than as an opaque `missing_scope` on the first create).
Scopes: `channels:read`, `groups:read`, `channels:manage`, `groups:write`, `users:read.email`.
`SLACK_TEAM_ID` is an optional companion that scopes the deep links to one workspace.

Per-user OAuth would mean a Slack identity per staff member, a token store, refresh handling and a
connect flow — for a feature whose whole job is to write two columns and open a URL.

**The consequence is the feature's defining limitation, and it is stated in the UI rather than
worked around:** `groups:read` returns only the **private** channels the app has been *added to*.
So the workspace listing (`getSlackChannels`) is **complete for public channels and structurally
partial for private ones** — which is exactly the scoping kind. A pre-existing scoping channel
must be `/invite`d to the app before it can be found, linked or suggested. The create dialog says
so, inline, under the picker, and **only on the private path** (`isPrivate`), because that is the
one place the blind spot bites someone.

`getSlackChannels` also **never throws** — the ADR 0029 rule, for the same reason: it sits on the
render path of two detail surfaces. It returns `{ configured, degraded, channels }`, degrading to a
partial list on a failed page or the `PAGE_MAX = 5` page cap (~1000 channels), and callers must
never read "not in this list" as "does not exist". The cost of that is a missed suggestion; Slack's
own `name_taken` is the real collision guard.

### 2. Two kinds, each owned by exactly one record, managed only on that record's own surface

`SLACK_CHANNEL_KINDS` = `scoping` | `project`. Each has a prefix, a visibility and exactly one
table (`src/lib/slack/channel.ts`, `src/actions/slack/slackChannelLink.ts`):

| Kind | Name | Visibility | Columns | Surface | Capability |
|---|---|---|---|---|---|
| `scoping` | `l-scoping-<slug>` | **private** | `opportunities.scopingSlackChannelId`/`Name` | the opportunity detail drawer | `crm.edit` |
| `project` | `l-project-<slug>` | **public** | `projects.slackChannelId`/`Name` | `/projects/[id]` | `projects.edit` |

Private for scoping (commercial discussion before a deal is public), public for delivery (anyone in
the business can follow it). That split is the whole reason the two kinds have such different
discoverability (§1).

**The opportunity drawer deliberately does not reach across to a project's channel.** A project can
be built from several opportunities (`opportunities.projectId`, many→one), so there would be no
unambiguous owner for the control — and a sales-only user would be looking at a permanently
disabled button for a capability they don't hold. **Carrying the scoping channel over when a
project is created is also out of scope**: different visibility, different members. Two channels,
two records, two lifecycles.

The name is built by the pure `buildSlackChannelName(kind, sourceName, fallbackId)`, which absorbs
the two edge cases Slack would otherwise reject with a user-facing error: the **80-char cap is
budgeted against the prefix** (and any hyphen left dangling by the cut is trimmed), and an
**unsluggable name** (`"★"`, `"(TBD)"`) falls back to the record's own CUID2 id rather than
emitting a bare `l-scoping-`. Accents are folded, not dropped, so `"Café Group"` is `cafe-group`.
**The dialog and the action call the same function**, so the previewed name and the created channel
cannot disagree.

### 3. Denormalized column pairs, not a `slack_channel_links` table

Two nullable `text` columns per owning table, plus per-table `uniqueIndex` and a `check`
(`opportunities_scoping_slack_channel_shape` / `projects_slack_channel_shape`) enforcing **both
null or both set**, so a half-written link is unrepresentable. All-null rows satisfy the check, so
**no backfill was needed** — the same shape-as-DB-invariant call as `projects_budget_shape`
([ADR 0053](./0053-project-budgets-and-margin.md)).

Both relationships are **1:1**, so a link table buys nothing and costs the FK: a polymorphic
`slack_channel_links(recordKind, recordId, …)` needs an **untyped `recordId` with no foreign key**,
which loses the cascade that drops the link for free when the deal or project is deleted, and
replaces a column read with a join on every detail read. A pair of concrete link tables would be
two tables plus two joins to store two strings.

The unique indexes are plain, not partial: Postgres treats NULLs as distinct, so the unlinked
majority is unconstrained. They are **named**, so `isUniqueViolation(error, target.uniqueConstraint)`
can key off them — the third layer of the double-click defence, after the pre-read and the `isNull`
guard on the update (the `associateOpportunityProject` idiom).

**Cross-kind uniqueness is a UX rule, not a DB invariant.** The same channel being both an
opportunity's scoping channel *and* a project's delivery channel is a mistake we prevent in
`linkSlackChannel` and hide from search/suggestions via `channelIdsAlreadyLinked` — a set-returning
lookup over a **candidate shortlist** (two indexed `IN` queries, regardless of how many records
exist). Deliberately not a constraint: it spans two tables, and it isn't a truth about the data —
someone could legitimately want it one day.

### 4. The gate is the record being written, via `metadata.authorize` — and no capability was added

All five actions declare `authorize: authorizeSlackChannel`, which parses `kind` off the **raw
`clientInput`** and calls `requirePermission(user, SLACK_CHANNEL_TARGETS[kind].permission)`.

**Why not a static `metadata.permission`:** `crm.edit` and `projects.edit` are **disjoint** in the
matrix — `sales` holds only the former, `delivery-manager` only the latter — so *any* single static
capability either locks out one of the two audiences or grants one of them access to the other
domain. This is exactly the input-dependent case `ActionAuthorize` exists for.

Two details that make it a gate rather than a formality:

- **An unparseable `kind` is denied, not skipped.** A hook that returns early when it can't read
  its own discriminant leaves the body running ungated.
- **`SLACK_CHANNEL_TARGETS` is the single place a kind maps to a table, a column pair, a capability
  and a revalidation.** If the hook decided which capability to require from one source and the
  action body decided which table to write from another, the two could disagree and a `crm.edit`
  holder could write a `projects` column. Reading both from the same entry makes that divergence
  **unrepresentable**. (`searchSlackChannelsSchema.kind` is `nullish` only to satisfy the generic
  `SearchAction` contract; the hook has already refused anything without a valid kind, and the body
  returns `[]` anyway.)

**`src/lib/auth/permissions.ts`, `src/lib/auth/permissions.test.ts` and the canonical matrix in
[permissions.md](../domains/permissions.md) are untouched, and should stay that way.** A
`slack.manage` capability would be a third way of spelling "may edit this record": the audience for
"may create the channel for this deal" is exactly the audience for "may re-price it".

### 5. The private-channel disclosure filter

`disclosableSlackChannels` is applied by search, suggestions **and `linkSlackChannel`** — one place
the rule lives, including on the write path, so an id pasted for an unrelated private channel can't
be linked (and its name echoed back) just because our bot is in it.

- **Public channels pass through untouched.** Every employee can already browse them in Slack, so
  surfacing them behind `crm.edit`/`projects.edit` is *narrower* than the status quo.
- **Private channels are filtered to the naming convention** (`isConventionChannelName`). A private
  channel's name is invisible to non-members in Slack, and our bot may well have been invited to an
  HR or exec channel for some unrelated reason. Without this filter the channel picker would
  quietly become a way to **enumerate those names**. The two prefixes are all this feature ever
  needs.

**Accepted cost:** an existing private channel that doesn't follow the convention can't be linked
until it's renamed. The dialog's notice says both halves ("added to" *and* "named `l-scoping-…`").

Search is **not** filtered to the kind's own visibility — a scoping channel accidentally created
public can still be linked. `SLACK_CHANNEL_IS_PRIVATE` governs what we *create*, not what we accept.

### 6. Creation is not transactional with the DB write, and Slack has no `conversations.delete`

Hence the step order in `createSlackChannel`, which **is the design**:

1. **reject if already linked** (and if the record is gone);
2. **build the name**, then a **collision precheck** against the cached listing — so the common case
   gets an actionable "link it instead" rather than Slack's `name_taken` (not authoritative, since
   the list may be degraded; the `name_taken` branch is still the real guard);
3. **resolve invitee Slack ids** — read `staff.email` server-side from the submitted **staff ids**
   (never emails from the client, or a caller could invite an arbitrary address), then one
   `users.lookupByEmail` per person. This is the **flakiest, highest-fan-out step**, and it runs
   **before** the irreversible call precisely so a total failure costs nothing;
4. **`conversations.create`** — the irreversible call. **The stored name is the one Slack returns**,
   not the one we asked for, because Slack normalises on create;
5. **persist**, guarded on `isNull`;
6. **on persist failure, `conversations.archive`** — the closest thing to a delete, and the
   compensating action. It is safe *precisely because nobody has been invited yet*, which is why
   invites come last. Plus a `slack_channel_orphaned` error log naming the channel, in case the
   archive also failed;
7. **invites, best-effort and non-fatal** — `force: true` (without it one stale user id aborts the
   whole call and costs everyone else their invite), chunked at 100, `already_in_channel` not counted
   as a failure, per-user rejections read off the `errors` array so a partial invite isn't reported
   as a clean one. Failures come back as a **`warnings` array** the dialog raises as a toast, since
   by then the dialog has closed.

`unlinkSlackChannel` **clears our columns and touches nothing in Slack** — that's what the
confirmation copy promises. It's in scope from day one because it's the only escape hatch for the
three ways a link goes bad: wrong channel linked, channel archived in Slack, or our bot removed
from it and no longer able to see it. `linkSlackChannel` likewise **never joins or invites**:
`conversations.invite` requires membership, and inserting our bot into somebody's existing private
channel isn't ours to do. Linking is a statement about our records, not an action inside Slack.

### 7. `updateTag`, not `revalidateTag`

`SLACK_CHANNELS_TAG` (1h) and `SLACK_USERS_TAG` (6h) are the **repo's first cache tags**. After a
create, `createSlackChannel` calls **`updateTag(SLACK_CHANNELS_TAG)`**.

This is Next 16.2.10 (a modified build — [ADR 0002](./0002-modified-nextjs.md)), where
single-argument `revalidateTag` is **deprecated** and the two-argument form is
**stale-while-revalidate** — which would keep serving a channel list *without the channel we just
created in it*, so the collision precheck and the search would both lie until the next refresh.
`updateTag` is immediate-expiry / read-your-own-writes, and is Server-Actions-only. `linkSlackChannel`
and `unlinkSlackChannel` deliberately **don't** call it: nothing changed in Slack, so the cached
listing is still accurate.

**Authenticated `fetch` does cache here, and that's verified, not assumed.** Next normally refuses
to cache a request carrying an `Authorization` header, but `patch-fetch.js` only applies
`autoNoCache` when there is **no explicit cache config** — an explicit `next: { revalidate, tags }`
wins. Both cached calls are **GET**s (`conversations.list`, `users.lookupByEmail`); every write is
POST + `cache: "no-store"`.

The transport itself is two functions, not an SDK (`slackApi.ts`), following ADR 0029: bare `fetch`,
Zod validation at the trust boundary, no vendor client. Two Slack-specific traps it exists to close:
**`res.ok` is not success** (Slack answers HTTP 200 with `{ ok: false, error }` for most failures,
including rate limiting), and **a bare `fetch` has no timeout** (every request carries a 10s
`AbortSignal.timeout`, or a hung connection hangs the action holding it). `SlackApiError` carries
Slack's own machine-readable code so each action maps only the handful it has real copy for.

### 8. The stored channel name is a display snapshot

`*SlackChannelName` exists **only so a linked channel renders without a Slack round-trip.** Every
link is by **channel id**, so a rename in Slack never breaks the hyperlink — it only makes the
stored label stale. Nothing writes the name back from a read: a read that repaired names would turn
every detail render into a Slack call, and the check constraints keep the pair consistent either way.

`toSlackChannelRef` is the one place a stored pair becomes UI shape, and it builds the
`slack.com/app_redirect?channel=…&team=…` deep link **server-side** so `SLACK_TEAM_ID` never ships
to a client just to concatenate a string.

**A linked channel renders as a hyperlink out to Slack, and that's all.** There is no in-app
join/invite-me action: joining is a Slack affordance, and for a private channel our bot can't grant
membership it doesn't have.

### 9. The suggestion is a client-triggered read, one record per call

When a slot is empty, `suggestSlackChannel` proposes a similarly-named workspace channel for
one-click linking. It is **deliberately not folded into the detail payload**: a cold channel-list
cache costs several sequential Slack round-trips, and neither the opportunity drawer nor the project
page should wait on Slack to render. The **stored link is on the detail payload for free** (both
columns are already on the row being read — no extra query, no extra join); only the suggestion
needs the network, and it fires after render (the `loadOpportunityPlan` idiom).

**Strictly one record per call. It must never be wired into a list or the kanban**, where it would
fan out into a Slack round-trip per card.

Matching is `scoreSlackChannelMatch` — Sørensen–Dice over character bigrams, no dependency, with
**both names' convention prefix stripped first**. That stripping is the whole trick: `l-project-acme`
and `l-project-zeta` share ten leading characters, so scoring the raw names would rate every project
channel a decent match for every other one. One adjustment on top: when one slug **wholly contains**
the other (`acme` inside `acme-platform-build`, the common "we shortened it" case) Dice scores it far
too low, so the result is floored at `0.7` — which is also `SLACK_CHANNEL_MATCH_THRESHOLD`, set so a
substring match clears it and a merely-similar name doesn't. **A wrong suggestion is worse than
none**, because acting on it links the wrong channel. Containment needs ≥3 characters, or `"a"` in
`"acme-platform"` would qualify. Only the top candidate is shown; a shortlist of 5 is checked for
existing links so the extras cover the case where the closest names are taken.

### 10. The feature is off when `SLACK_BOT_TOKEN` is absent — but the row is hidden only from people who couldn't act on it

> **Amended 2026-08-04, same day as filing.** This section originally read "the row hides itself"
> unconditionally (`!enabled && !channel → null`). That is now gated on `canManage` as well —
> see *the reversal* below. The rest of the section stands.

`isSlackConfigured()` is a cheap synchronous env read, passed to the UI as `slackEnabled` (on the
opportunity drawer's **envelope**, not on `OpportunityDetail`, because it describes the
*environment*, not the opportunity — the same reason `currentStaff` sits there).

`SlackChannelField` resolves five cases, and the interesting axis is **not** whether the token
exists but **whether this viewer could do anything about it**:

| # | Channel | Token | `canManage` | Renders |
|---|---|---|---|---|
| 1 | linked | either | either | the Slack hyperlink (unlink offered with `canManage`) |
| 2 | — | set | yes | "Create or link" + the suggestion line |
| 3 | — | set | no | muted "Not linked" |
| 4 | — | **absent** | **yes** | muted **"Slack isn't connected"** |
| 5 | — | absent | no | **nothing — the row is hidden** |

So the guard is `if (!enabled && !channel && !canManage) return null`.

**An already-stored link always renders, token or not** (case 1), because `app_redirect` is just a
URL and needs no bot — dropping it because a token was removed would lose information for nothing.
**Unlink still works** on that row too: it's app-side only.

**The reversal, and why.** Hiding the row from *everyone* without a token was the first behaviour, on
the argument that "Slack isn't configured" is **admin-facing noise on a sales surface**. That
argument is still right for an arbitrary viewer — which is exactly why case 5 keeps hiding it — but
it was the **wrong weighting for someone who holds the capability**: an invisible feature can't be
discovered, adopted, or debugged, so the one person whose job it would be to connect Slack was the
one person guaranteed never to learn the slot existed. Gating the hide on `canManage` is what lets
both concerns hold at once: no noise for a reader, an explanation for an actor. **Case 4 is
deliberately inert, not disabled-with-a-tooltip** — there is nothing for the viewer to click, and
the fix is an env var, not an in-app action.

Note the case-4 branch is only reachable *because* of the early return above it; the two must be
read together, and changing either without the other silently re-hides or double-renders the row.

### 11. Not seeded, deliberately

`scripts/seed/` is unchanged. The columns are nullable, so nothing is required — and a fake `C…`
channel id would render a hyperlink that **errors inside Slack**, while leaving the empty-state,
dialog and suggestion paths (the parts that actually have logic) never exercised in dev. An unset
`SLACK_BOT_TOKEN` locally exercises §10 instead, which is the honest local state.

### 12. Where the code lives

- **`src/lib/slack/channel.ts`** — pure and client-importable (no `db`, no drizzle, no `env`): the
  kinds, prefixes, visibility map, `slugifyChannelName`, `buildSlackChannelName`,
  `isConventionChannelName`, `slackChannelUrl`, `formatSlackChannel`, `scoreSlackChannelMatch` +
  its threshold, and the `SlackChannelRef` type. It gets **its own `src/lib` folder** rather than
  living under `crm/` or `projects/` because the module spans **both** domains — one owns each kind —
  so neither is its home. That is the same role `format/fx.ts` plays for FX, and the case ADR 0036
  makes room for.
- **`src/actions/slack/`** — the transport (`slackApi.ts`), the cached reads (`getSlackChannels.ts`,
  `slackUsers.ts`), the target table (`slackChannelLink.ts`), the gate
  (`authorizeSlackChannel.ts`), the pure client-importable input schemas
  (`slackChannel.schema.ts`, per [ADR 0035](./0035-schema-modules-by-import-boundary.md)), the
  read→UI adapter (`slackChannelRef.ts`), and the five actions.
- **`src/components/slack/`** — `slack-channel-field.tsx` (the one slot both surfaces mount),
  `slack-channel-dialog.tsx` (create *and* link in one dialog), `slack-channel-suggestion.tsx`.
- **`src/lib/slack/channel.test.ts`** — a further sanctioned exception to
  [ADR 0037](./0037-unit-tests-removed-except-rbac-matrix.md), on the usual grounds: the cap-vs-prefix
  budget, the empty-slug fallback, the prefix-stripped scoring, and — the load-bearing one — that
  `isConventionChannelName` **rejects everything else**, since it is the private-channel disclosure
  gate (§5).

## Consequences

- **Scoping-channel search and suggestions are incomplete by construction** (§1). This is the
  first feature in the codebase whose *correctness* depends on a state we don't control (whether
  the app was invited). The UI explains it; nothing retries or works around it.
- **The projects domain gained a second external dependency, and the CRM its first.** Both detail
  surfaces now have a code path that talks to a third party — but neither *blocks on it to render*:
  the stored link comes off the row, and only the suggestion is a round-trip (§9). Keep it that way.
- **`getProjectPlan` returns `slack` as a sibling of `project`, not on `PlanProject`.** That type is
  shared with `getOpportunityPlan`, and putting it there would oblige a second read to supply a
  field the planner grid never renders — the same reasoning that keeps delivery notes out of
  `ProjectDetailPlan` ([ADR 0059](./0059-project-delivery-notes-and-list-health.md)).
  `getOpportunity` returns `slack` = the **scoping** channel only (§2).
- **`/projects/[id]` gained a fifth read** — `getCurrentStaffIdentity()`, purely to default the
  create dialog's invite list to the viewer, mirroring what the opportunity drawer already bundled.
- **Two `searchStaff` actions are used, one per kind** (`crm/searchStaff` for scoping,
  `projects/searchStaff` for project), because they carry the two different gates. Reusing that
  split beats inventing a third search whose gate would have to cover both.
- **A channel can be orphaned in Slack** if `conversations.create` succeeds and both the persist
  *and* the compensating archive fail. That path logs `slack_channel_orphaned` with the channel name
  and tells the user which channel to look for. There is no reconciliation job.
- **Secret management is now a real concern.** ADR 0029 deliberately picked a keyless API to avoid
  it; this is the first secret beyond `DATABASE_URL`/`BETTER_AUTH_SECRET`/the Google pair. Rotating
  the token or reinstalling the app is an ops action with no in-app surface — `missing_scope`,
  `invalid_auth`, `token_revoked` and `account_inactive` are each mapped to copy telling the user
  what happened rather than leaking Slack's error.
- **The two cache tags are the first in the repo.** Anything added later that mutates the channel
  list must `updateTag` it (§7); anything that only mutates *our* columns must not.
- **No permission changed.** Don't "tidy" the `authorize` hook into a static `metadata.permission` —
  that's the bug §4 exists to prevent.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Per-user Slack OAuth | A token store, refresh handling and a connect flow, to write two columns and open a URL. It *would* fix the private-channel blind spot — the named upgrade path if that limitation ever becomes intolerable (§1) |
| A polymorphic `slack_channel_links` table | An untyped `recordId` with no FK, so the delete cascade is lost, plus a join on every detail read — for two 1:1 relationships (§3) |
| Two concrete link tables | Two tables and two joins to store two strings, with the same 1:1 cardinality a column pair already expresses (§3) |
| A DB constraint for cross-kind uniqueness | It spans two tables, and it isn't a truth about the data — it's a UX guard, enforced in `linkSlackChannel` + `channelIdsAlreadyLinked` (§3) |
| A static `metadata.permission` on the five actions | `crm.edit` and `projects.edit` are disjoint; any single capability locks out one audience or over-grants the other (§4) |
| A new `slack.manage` capability | A third spelling of "may edit this record"; the audiences are identical and a matrix row would engage ADR 0014's lockstep for nothing (§4) |
| Let the picker list every channel the bot can see | Turns it into a way to enumerate the names of private HR/exec channels the bot was invited to for unrelated reasons (§5) |
| Manage the project channel from the opportunity drawer too | Many opportunities → one project, so no unambiguous owner for the control — and a permanently disabled button for a sales-only viewer (§2) |
| Carry the scoping channel over when a project is created | Different visibility and different members; a private pursuit channel is not a public delivery channel (§2) |
| Invite people on **link** as well as create | `conversations.invite` requires membership, and quietly inserting our bot into someone's existing private channel isn't ours to do (§6) |
| An in-app "join channel" / "invite me" action | Joining is a Slack affordance, and for a private channel our bot can't grant membership it doesn't have (§8) |
| Invite first, then create | Impossible — but the *shape* of it (resolve invitees last) is what would strand a channel on the flakiest step. Resolution moved before the irreversible call for exactly that reason (§6) |
| `revalidateTag` after a create | Single-arg form is deprecated in this build; the two-arg form is stale-while-revalidate, so search would keep serving a list without the new channel (§7) |
| Fold the suggestion into the detail read | Several sequential Slack round-trips on the render path of both surfaces, for a guess (§9) |
| Refresh the stored name on read | Turns every detail render into a Slack call, to fix a label that only affects display; the id is what the link is built from (§8) |
| Editable channel names | The convention is the point — and the preview would then have to be validated against Slack's own naming rules client-side (§2) |
| Hide the feature-off row from **everyone** (the original §10) | Reversed same-day: the person who'd connect Slack was the one guaranteed never to learn the slot existed. Hidden only from viewers who couldn't act (§10) |
| Show a configured-vs-not notice to every viewer | The other extreme — admin-facing noise on a sales surface, which is what case 5 still avoids (§10) |
| A `slack_channel` seed fixture | A fake `C…` id renders a link that errors inside Slack, and leaves the empty-state/suggestion paths unexercised (§11) |
| A Slack SDK (`@slack/web-api`) | ADR 0029's posture: two `fetch` wrappers, Zod at the boundary, no vendor client to keep current (§7) |
