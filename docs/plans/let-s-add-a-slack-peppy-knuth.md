# Slack channel links for opportunities and projects

## Context

Deals and delivery already happen in Slack, but nothing connects a Slack channel to
the record it belongs to. People hunt for "the Acme channel" by memory, scoping
channels get recreated because nobody knows one exists, and there is no way to jump
from an opportunity to the conversation about it.

This adds a **two-way-visible link** between our records and Slack channels:

- An **opportunity** gets a **scoping** channel — `l-scoping-<slug>`, **private** —
  managed from the opportunity drawer.
- A **project** gets a **project** channel — `l-project-<slug>`, **public** — managed
  from the project detail page.
- **One slot per surface.** Each record owns exactly the channel that lives on it; the
  opportunity drawer does not reach across to the project's channel.
- Each slot can be **created** (we make the channel in Slack and invite people) or
  **linked** to a channel that already exists.
- When a slot is empty and a similarly-named workspace channel exists, we **propose
  it** for one-click linking.

Intended outcome: one click from a record to its Slack conversation, and one obvious
place to set that up so channels stop being duplicated.

This is also the repo's **first secret-bearing external integration** — ADR 0029
established the outbound-HTTP pattern with a keyless API and explicitly deferred
secret management. That is the main architectural weight here.

### Decisions already settled with the user

| Question | Decision |
|---|---|
| Slack auth | **One workspace bot token.** No per-user OAuth. |
| Private-channel discovery | Accept the limit: the bot only sees private channels it's in. The link flow tells the user to `/invite @App`, then search again. |
| `{name}` in the template | Derived from the **opportunity name** (scoping) / **project name** (project). **Not user-editable** — shown as a read-only preview. |
| Permission gate | The record being written: scoping → `crm.edit`, project → `projects.edit`. No new capability. |
| "User can be linked to the channel" | A **hyperlink out to Slack**. No in-app join/invite-me action. |

## Constraints worth knowing before you start

1. **Private channels are only visible to the bot once it's a member.** `groups:read` is
   scoped to "private channels your app has been added to." So scoping-channel *search*
   and *suggestions* only cover channels we created or were invited to. This is a
   product limitation we surface in copy, not a bug to fix.
2. **Channel creation is not transactional with the DB write.** There is no
   `conversations.delete`. See the ordering in `createSlackChannel` below.
3. **This is Next 16.2.10.** `revalidateTag(tag)` single-arg is **deprecated**
   (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md`).
   Use **`updateTag(tag)`** — Server-Actions-only, immediate expiry, read-your-own-writes
   (`updateTag.md`). This is the repo's first cache tag.
4. **`fetch` + `next: { revalidate, tags }` does work for authenticated Slack GETs.**
   `dist/server/lib/patch-fetch.js` only applies `autoNoCache` for an `Authorization`
   header when there is *no* explicit cache config; an explicit `revalidate: n` wins.
   `conversations.list` and `users.lookupByEmail` accept GET. The two writes
   (`conversations.create`, `conversations.invite`) are POST-only → `cache: "no-store"`.
5. **Slack scopes to request:** `channels:read`, `groups:read` (list), `channels:manage`,
   `groups:write` (create + archive + invite), `users:read.email` (lookup). Nothing more.
6. **Verify `conversations.invite` specifics against docs.slack.dev at implementation
   time** — the per-call user cap and whether `force: true` is needed to tolerate
   partial failure. Design for chunking + non-fatal partial failure either way.

---

## Data model

Denormalized columns, **no new table**. Both relationships are 1:1 (one scoping channel
per opportunity, one channel per project), the cascade comes free with a real FK-bearing
row, and a polymorphic link table would need a `kind` + untyped `recordId` with no FK.
Cross-kind uniqueness (a channel linked in two places) is a UX mistake to prevent in the
action, not a data-integrity invariant.

**`src/lib/db/opportunities-schema.ts`**
```ts
scopingSlackChannelId: text(),      // Slack "C…" id
scopingSlackChannelName: text(),    // snapshot at link time; may drift if renamed in Slack
```
plus `uniqueIndex("opportunities_scoping_slack_channel_idx").on(t.scopingSlackChannelId)`
(a plain unique index permits multiple NULLs in Postgres — no partial index needed) and
`check("opportunities_scoping_slack_channel_shape", …)` asserting **both null or both
set**, mirroring the existing `projects_budget_shape` idiom in `projects-schema.ts`.

**`src/lib/db/projects-schema.ts`** — same two columns as `slackChannelId` /
`slackChannelName`, with `projects_slack_channel_idx` and `projects_slack_channel_shape`.

**Migration:** `bun run db:generate` → `drizzle/0024_*.sql` + snapshot + `_journal.json`.
Never hand-written. No backfill (all-null satisfies both checks).

**Seed:** `scripts/seed/wipe.ts` needs **no change** (no new table; `truncate` already
clears columns) and `scripts/seed/sales.ts` / `projects.ts` need **no change** (nullable,
no default → optional in `InferInsertModel`). **Deliberately not seeded** — a fake `C…`
id renders a hyperlink that errors inside Slack, and it would mean the empty-state and
suggestion paths (the most fragile UI here) never get exercised in dev. Leave one comment
line in each seeder saying so, so nobody "fixes the gap".

## Environment

**`src/env.ts`** — following the Google optional-pair idiom:
```ts
// Set to turn on the Slack channel integration (src/actions/slack/).
SLACK_BOT_TOKEN: optionalString.refine(…startsWith("xoxb-")…),  // fail fast on a pasted user token
SLACK_TEAM_ID: optionalString,   // scopes app_redirect links for multi-workspace users
```
`.env.example` gets a commented-out block. The feature is **off** when the token is
absent. Channel URLs are built **server-side** (`slackChannelUrl(id, env.SLACK_TEAM_ID)`)
and shipped as a ready `url` on the payload, so no client ever needs the team id.

---

## Backend

### Pure, client-importable — `src/lib/slack/`

Justified under ADR 0036: this spans CRM *and* projects, so neither domain folder owns
it; it plays the role `src/lib/format/fx.ts` plays for the FX call.

**`src/lib/slack/channel.ts`** — no `db`, no drizzle, no env:
`SLACK_CHANNEL_KINDS`, `SlackChannelKind`, `SlackChannelRef = { id, name, url }`
(`name` bare, no `#`), `SLACK_CHANNEL_PREFIX`, `SLACK_CHANNEL_NAME_MAX = 80`,
`slugifyChannelName`, `buildSlackChannelName(kind, sourceName, fallbackId)`,
`isConventionChannelName`, `slackChannelUrl(channelId, teamId?)`,
`scoreSlackChannelMatch(candidate, expected)`, `formatSlackChannel` (adds the `#`).

The dialog's read-only preview and the server's `conversations.create` call the **same**
`buildSlackChannelName`, so preview and reality cannot drift — that's why it's a pure lib
rather than a server-computed string on the wire.

Name-building edge cases that must be handled: budget the prefix against the 80-char cap
(`l-scoping-` is 10 → slug ≤ 70); strip Slack's disallowed charset and lowercase; and an
**empty slug** (an opportunity named `"★"` or `"— (TBD)"` → `l-scoping-`) must fall back
to a suffix from the record id rather than producing Slack `invalid_name`.

**`src/lib/slack/channel.test.ts`** — a defensible exception to ADR 0037 (pure logic,
invisible to types, and a malformed name surfaces as a user-facing Slack error): the
80-char truncation with the prefix budgeted, charset stripping, empty-slug fallback.
Don't test the scorer.

### Server-only plumbing — `src/actions/slack/`

Per ADR 0029, external I/O lives in the actions layer, not `src/lib`.

**`slackApi.ts`** — `import "server-only"`. `isSlackConfigured()`;
`class SlackApiError extends Error { code; retryAfterSeconds? }`;
`slackGet(method, params, { revalidate, tags }, schema)` and
`slackPost(method, body, schema)` (`cache: "no-store"`). Both: `Authorization: Bearer`,
`AbortSignal.timeout(10_000)` (bare `fetch` has no timeout — a hung Slack call would hang
the action), zod-parse every body, and **throw on `ok: false` at HTTP 200** — `res.ok`
alone is not sufficient for Slack. Two functions, not an SDK.

429 handling: Slack returns both HTTP 429 with `Retry-After` **and** `200 { ok: false,
error: "ratelimited" }`. Never auto-retry inside an action; map to a `UserSafeActionError`
quoting the wait.

**`getSlackChannels.ts`** — server-only, the ADR 0029 read shape.
`{ configured, degraded, channels: Array<{ id, name, isPrivate }> }` from
`conversations.list` GET (`limit=200`, `exclude_archived=true`,
`types=public_channel,private_channel`), `next: { revalidate: 3600, tags: [SLACK_CHANNELS_TAG] }`.
**Never throws.** Page cap `SLACK_CHANNEL_PAGE_MAX = 5` (~1000 channels) with
`logger.warn("slack_channels_page_cap")` — AGENTS.md forbids silent caps. A mid-pagination
failure returns the pages gathered so far with `degraded: true`, not `[]`: a partial list
can only cause a missed suggestion, and the `name_taken` path already covers the
consequence.

*Known wrinkle:* cursor pagination means one cache entry per cursor, so a cached page 1
with an expired cursor can fail page 2. The bounded loop + `degraded` return absorbs this.
If it ever bites, wrap the whole loop in `unstable_cache` (one entry, one tag).

**`slackUsers.ts`** — `resolveSlackUserIds(emails)` → `{ userIds, missingEmails }` via
cached `users.lookupByEmail` GETs (`revalidate: 21600`, `SLACK_USERS_TAG`), tolerating
`users_not_found`. Emails come from `staff.email` server-side — the client only ever sends
staff ids.

**`slackChannelLink.ts`** — the single map that makes kind/table divergence
unrepresentable, consumed by **both** the authorize hook and every action body:
```ts
export const SLACK_CHANNEL_TARGETS: Record<SlackChannelKind, {
  table; idColumn; nameColumn; sourceNameColumn; permission: PermissionCheck;
}> = { scoping: { …opportunities…, permission: { crm: ["edit"] } },
       project:  { …projects…,      permission: { projects: ["edit"] } } };
```
Plus `readSlackChannelLink(kind, recordId)`, `channelIdsAlreadyLinked(ids)` (an `inArray`
over the top few candidate ids across both columns — never a full scan), and
`revalidateSlackLink(kind, recordId)` (scoping → `/opportunities`; project →
`revalidateProject`).

Because each kind is managed only on its own surface, `recordId` is always the id of the
table that holds the column — an opportunity id for `scoping`, a project id for
`project`. Keeping the targets map as the single source of table/column/permission still
matters: it's what makes kind/table divergence unrepresentable in the authorize hook and
every body.

**`authorizeSlackChannel.ts`** — a shared `ActionAuthorize`, following
`authorizeTaskDone` / `authorizeStaffEdit`. Static `metadata.permission` **cannot** express
this gate: `crm.edit` and `projects.edit` are disjoint in the matrix (`sales` has only the
former, `delivery-manager` only the latter), so there is no common static capability. The
hook parses `kind` off the raw `clientInput` with `slackChannelKindSchema` and
**throws on anything unparseable** — an authorize hook that returns early when it can't
read its discriminant is a bypass. Then `requirePermission(user, SLACK_CHANNEL_TARGETS[kind].permission)`.

**No permission-matrix change.** `permissions.ts`, `permissions.test.ts` and
`docs/domains/permissions.md` stay untouched.

### Schemas — `src/actions/slack/slackChannel.schema.ts`

Client-imported, so hand-written `z.object` only (no drizzle). `slackChannelKindSchema`,
`slackChannelTargetSchema = { kind, recordId }`, `createSlackChannelSchema`
(`+ staffIds: z.array(id).max(50).default([])`), `linkSlackChannelSchema`
(`+ channelId: z.string().min(1).max(32)`), `unlinkSlackChannelSchema`,
`searchSlackChannelsSchema = searchQuerySchema.extend({ kind })`. Each exports its
inferred `…Input` type.

### Actions

All `'use server'`, all gated by `metadata({ authorize: authorizeSlackChannel })`.

**`createSlackChannel.ts`** — ordering is the whole design here:
1. `readSlackChannelLink` → reject if already linked.
2. `buildSlackChannelName` (reject a blank source name).
3. Collision precheck against the cached channel list.
4. **`resolveSlackUserIds` — before creating.** The flakiest, highest-fan-out calls must
   precede the irreversible one; a total lookup failure then costs nothing.
5. `conversations.create`. **Store `response.channel.name`, not the requested name** —
   Slack normalizes on create.
6. Persist with the `isNull(...)` atomic guard (the `associateOpportunityProject` idiom),
   catching `isUniqueViolation` from `src/lib/db/unique-violation.ts`.
7. **If the persist fails** → `updateTag(SLACK_CHANNELS_TAG)`, best-effort
   `conversations.archive` (there is no `conversations.delete`; archiving is safe because
   nobody has been invited yet and the channel is seconds old),
   `logger.error("slack_channel_orphaned", { id, name })`, then a `UserSafeActionError`
   naming the channel.
8. `conversations.invite`, chunked, **non-fatal** — partial failures come back as
   `warnings`, tolerating `already_in_channel`.
9. `updateTag(SLACK_CHANNELS_TAG)` + `revalidateSlackLink`.

Error map: `name_taken` → *"#x already exists — link it instead."*; `invalid_name*` →
*"That name isn't valid for Slack"* (unreachable if the builder is right — log it as a
builder bug); `restricted_action` → *"Your workspace restricts channel creation"*;
`missing_scope` → *"The Slack app is missing a permission"*; `invalid_auth` /
`account_inactive` → *"The Slack connection needs reconnecting"*.

**`linkSlackChannel.ts`** — validate the channel exists in the cached list and is not
already linked; persist with the `isNull` guard; resolve the stored name **server-side**
so a client can never write a fake channel name. **No invite, no auto-join** —
`conversations.invite` requires the caller to be a channel member, and silently joining
a bot to someone's private channel is not ours to do. Revalidate paths only.

**`unlinkSlackChannel.ts`** — clears both columns (`.returning()`-guarded). **Never
touches Slack.** In scope from day one: it's the escape hatch for a wrong link, an
archived channel, or a bot that got removed.

**`searchSlackChannels.ts`** — `SearchAction`-shaped so it drops straight into
`EntityCombobox`. Filters the cached list in memory, capped at `SEARCH_LIMIT`, requires a
non-blank query (so the picker can't be used to dump the workspace), excludes
already-linked ids. Returns `{ id, name }` with the **`#` included** so the shared
combobox label renders correctly.

> **Disclosure tightening:** return private channels **only** when
> `isConventionChannelName(name)`. Public channels are already browsable by every employee
> in Slack, so gating them behind `crm.edit`/`projects.edit` is narrower than the status
> quo. Private channels are the real new disclosure — the bot may have been invited to an
> HR or exec channel for unrelated reasons, and a private channel's *name* is invisible to
> non-members in Slack. The prefix filter is all the feature needs and removes
> unrelated-private-channel enumeration entirely. Cost: a pre-existing private channel not
> following the convention can't be linked until renamed — say so in the `/invite` copy.

**`suggestSlackChannel.ts`** — the only piece needing a live Slack round-trip, so it's a
client-triggered read on the `loadOpportunityPlan` precedent. Scores the cached list
against `buildSlackChannelName(kind, sourceName)`, excludes already-linked ids, returns
the single best candidate above a threshold or `null`. Compute for **one record only** —
never for a list or kanban, or it fans out per card.

**Do not fold this into `loadOpportunityDetail`:** a cold channel-list cache is 2–3
sequential Slack round-trips, and the drawer must not wait on Slack to open.

### Reads to extend (zero new queries)

- **`src/actions/crm/getOpportunity.ts`** — add `slack: SlackChannelRef | null` for the
  **scoping** channel only. Both columns are on the `opportunities` row already being
  selected, so this touches no join. Whitelist them explicitly per ADR 0063/0065 — never
  spread a row.
- **`src/actions/crm/loadOpportunityDetail.ts`** — add `slackEnabled: boolean` to
  `OpportunityDrawerData` (the envelope, next to `currentStaff`). It's environment, not a
  property of the record.
- **`src/actions/projects/getProjectPlan.ts`** — add `slack: SlackChannelRef | null` as a
  sibling field on `ProjectDetailPlan`, from the existing `projectRow` select.
  Deliberately **not** on `PlanProject` — that type is shared with `getOpportunityPlan`,
  and putting it there would force a second read for a field the planner never renders.

Keep `…ChannelName` as a snapshot. `suggestSlackChannel` may overlay the live name from
the already-cached list, falling back to the snapshot when degraded — but **never write a
fresh name back from a read**.

---

## Frontend

### Placement — one row in the meta rail on each surface

The linked row is `#l-scoping-acme` + an unlink icon, narrower than `ContactsField`'s
value; all the bulk (name preview, invitee picker, `/invite` guidance, channel search)
lives in a dialog. A dedicated tab or section for a single hyperlink would be wrong
weight on both surfaces.

Rendered via `FormField` + `labelAction` (the unlink `IconButton` sits exactly where every
other row's pencil sits) so it inherits `COMPACT_META_FIELDS` on the drawer and
`SidebarSection`'s label styling on the project page.

```
Opportunity drawer — Details tab        Project detail page
┌─ 18rem rail ─────────┐                ┌─ 320px sidebar ────────┐
│ Line of business   ✎ │                │ [▤] Acme platform   ✎ │
│ Source             ✎ │                │ ● Active               │
│ Company            ✎ │                │ COMPANY             ✎ │
│ Contacts           ✎ │                │ LINE OF BUSINESS       │
│ Owners             ✎ │                │ DELIVERY MANAGERS   ✎ │
│ ──────────────────── │                │ ────────────────────── │
│ Scoping channel    ⨯ │                │ SLACK CHANNEL       ⨯ │
│ #l-scoping-acme    ↗ │                │ #l-project-acme     ↗ │
└──────────────────────┘                └────────────────────────┘

Row variants (identical on both surfaces)
│ Scoping channel      │   │ Scoping channel        │
│ [⌗ Create or link]   │   │ [⌗ Create or link]     │
│                      │   │ Found #l-scoping-acme  │
│                      │   │             [Link]  ⨯  │
```

Opportunity drawer: after `<OwnersField>`, under a hairline divider — the rail's only
*external* fact, so it shouldn't read as another opportunity attribute. Project detail:
the **last row of the existing `SidebarSection`**, after `DeliveryManagersField`.

### Suggestion — an inline line, not a notice

One muted `text-xs` line under the empty-slot button: `Found #l-scoping-acme` + a ghost
`Link` button + a dismiss `IconButton`. **Not `InlineNotice`** — a bordered strip is the
wrong weight for a guess, and its tones read *muted = FYI* or *destructive = problem*;
this is an affordance. Keeping it inside the row also means it never has to say *which*
slot it belongs to.

**Dismissal is component-local `useState`.** No `localStorage`, no DB column. There is
zero web-storage usage in `src` today; it can't be read during render, so on the SSR'd
project page you'd get a flash-then-hide or a `useEffect` delay; per-browser is the worst
option for a shared record (dismiss on the laptop, see it again on the desktop, teammates
see it regardless); and keys are never GC'd. Because the suggestion is a quiet line inside
an already-empty slot, re-showing it on reopen costs nothing. If it ever annoys,
`sessionStorage` is the cheap next step — still not a column.

### Dialog — one per slot, create first

```
┌─ Scoping channel ─────────────────────────────────────────┐
│ A private channel for the pursuit team. Create one from    │
│ the deal name, or link a channel that already exists.      │
│                                                            │
│ Channel name                                               │
│ ┌ #l-scoping-acme-platform-build        (read-only) ──────┐│
│ Derived from the opportunity name; not editable.           │
│                                                            │
│ Invite                                                     │
│ ┌ [Andrew Xia ×] [Jane Roe ×]  Search staff…  ────────────┐│
│                                                            │
│ ── or link an existing channel ───────────────────────────  │
│ ┌ Search channels…                        ┐ [ Link ]       │
│ ⓘ Can't find it? Our bot only sees private channels it's   │
│   been added to. Run /invite @<App> in the channel, then    │
│   search again.                  ← scoping kind only        │
│                                                            │
│ [serverError]                          Cancel  [ Create ]  │
└────────────────────────────────────────────────────────────┘
```

- Create is **first**, deliberately inverted from `NoProjectState`: the name isn't
  editable, so creating is one confirm, and the "already exists" case is mostly handled
  upstream by the suggestion.
- **Preview** = `FormField` wrapping `<Input readOnly aria-readonly>` (not a `<p>` — it
  looks like the field it stands in for, and stays selectable) + the muted helper line.
- **`/invite` guidance** is an `InlineNotice tone="muted"` under the link combobox,
  **only for `kind === "scoping"`** — adjacent to the exact control that will fail you,
  invisible on the public path, never in the rail. Don't branch
  `searchEmptyMessage`; it's shared by both entity comboboxes.
- **`forceMountOverlay` unconditionally** (with a comment): the opportunity surface is a
  Sheet; at top level it's a visual no-op — same call `CreateProjectFromOpportunityDialog`
  and `ConfirmDialog` already make.
- **No react-hook-form.** There are no registered inputs — one chip picker and a read-only
  preview. `useState<EntityOption[]>` + `useAction`, submitted through a real
  `<form onSubmit>` so `FormDialogFooter`'s submit works. The `Link` button is
  `type="button"`. Same call `NoProjectState` makes.
- **Feedback** per `.claude/rules/forms.md`: dialog flows confirm by **closing** (no
  toast), failures land on `FormDialogFooter serverError`. The suggestion's one-click Link
  and the unlink are in-place → `toast.success` / `toast.error(error.serverError ?? …)`.
- **Unlink** is the row's `labelAction` `IconButton` → `ConfirmDialog`: *"Unlink #x? The
  channel stays in Slack — this only clears the link here."* The copy is the whole point
  of the control, so it doesn't belong in the dialog.

### Feature-off state

Hide the row when `slackEnabled` is false **and** nothing is linked; keep rendering an
existing link (`app_redirect` is just a URL and needs no bot, so losing it from the UI on
token removal would be gratuitous). Unlink still works — it's app-side only. Create, link
and suggestion are suppressed.

The flag reaches the client exactly as `canEdit`/`canCreateProject` do: computed
server-side, passed as a prop. **Do not add `NEXT_PUBLIC_SLACK_ENABLED`** — it mirrors a
secret's presence and will drift.

### Components

| File | What |
|---|---|
| `src/components/slack/slack-channel-field.tsx` (new) | `SlackChannelField` — the one unit both surfaces use. Props: `{ kind, recordId, sourceName, channel, label, canManage, enabled, currentStaff, onChanged? }`. Owns `dialogOpen`, `confirmUnlinkOpen`, `dismissed`, and `useAction` for `suggestSlackChannel` (effect-fired only when `enabled && canManage && !channel`), `unlinkSlackChannel`, `linkSlackChannel`. Returns `null` when `!enabled && !channel`. |
| `src/components/slack/slack-channel-dialog.tsx` (new) | `SlackChannelDialog`. Invitee picker = `EntityMultiCombobox` with the search action chosen from a module-local `Record<SlackChannelKind, SearchAction>` (`scoping → @/actions/crm/searchStaff`, `project → @/actions/projects/searchStaff`) — reusing the existing per-gate duplication rather than inventing a third staff search. Link picker = `EntityCombobox searchAction={searchSlackChannels} searchArgs={useMemo(() => ({ kind }), [kind])}`. Invitees default to `currentStaff ? [currentStaff] : []` and are **removable** (the requirement says *default*, not lock). |
| `src/components/slack/slack-channel-suggestion.tsx` (new) | `{ suggestion, pending, onLink, onDismiss }` — the one muted line. |
| `src/components/crm/opportunity-detail/sheet.tsx` | Hold `slackEnabled` from `result.data` next to `currentStaff`; thread it + `currentStaff` into `OpportunityDetailView`; render `SlackChannelField` **directly** (no adapter file) after `<OwnersField>` in a `border-t pt-3` wrapper, `kind="scoping"`, `recordId={detail.id}`, `sourceName={detail.name}`, `canManage` from the drawer's existing `crm.edit` context, `onChanged={refresh}`. No change to `Tabs`. |
| `src/components/projects/detail/project-detail-view.tsx` | New props `slackEnabled`, `slack`, `currentStaff`; render `SlackChannelField` directly as the last child of `SidebarSection`, `kind="project"`, `recordId={project.id}`, `sourceName={project.name}`, `canManage={canEdit}`, no `onChanged` (the actions revalidate this route). |
| `src/app/(app)/projects/[id]/page.tsx` | Add `getCurrentStaffIdentity()` to the existing `Promise.all`; pass `slackEnabled={isSlackConfigured()}`, `currentStaff`, `slack={plan.slack}`. Keep the Slack read inside `getProjectPlan` — `generateMetadata` already double-calls it; don't add a third sibling read. |

Concurrency on every write: pre-read reject + `isNull` atomic guard + unique-violation
catch. Three layers, all cheap, and they cover the double-click.

---

## Docs (dispatch the `librarian` subagent after implementing)

- **`docs/decisions/0066-slack-channel-links.md`** (0012 is a gap, so 0066 is next):
  bot-token-only and why not per-user OAuth; denormalized columns over a link table;
  kind → capability via `authorize` rather than a new matrix row; the private-channel
  prefix filter as a disclosure limit; non-transactional create + archive compensation;
  and the fact that this supersedes ADR 0029's deferral of secret management.
- **`docs/domains/slack.md`** — new domain doc (nothing existing fits).
- Update `docs/data-model.md`, `docs/architecture.md`, `docs/domains/crm.md`,
  `docs/domains/projects.md`, and the `AGENTS.md` status paragraph.
- `docs/domains/permissions.md` and `permissions.test.ts` are **unchanged** — no new
  capability.

## Verification

**Static (mine to run, and expected before I claim done):**
1. `bun run check` — Biome + `tsc --noEmit` + `bun test`. Must include the new
   `src/lib/slack/channel.test.ts` passing and the unchanged permission-matrix test.
2. `bun run build` — production compile.
3. `bun run db:generate` produces exactly one migration; inspect the SQL for the four
   columns, two unique indexes, two check constraints, and no destructive statement.
4. `/audit-rbac` — confirm `authorizeSlackChannel` denies by default, that every Slack
   action declares a gate, and that no body picks its table from anything but
   `SLACK_CHANNEL_TARGETS[kind]`.
5. `/code-review` and `/security-review` on the diff before merging.

**Runtime (yours — I don't run the app).** With `SLACK_BOT_TOKEN` unset first:
- Opportunity drawer and project page render with no Slack rows, nothing broken.

Then with a bot token carrying the six scopes, in a test workspace:
1. Open an opportunity → **Scoping channel → Create or link** → confirm the preview reads
   `#l-scoping-<deal-slug>`, add a second person → Create. Dialog closes; the row shows
   the channel as a link; clicking it opens Slack. Both people are in a **private**
   channel.
2. Repeat Create on a second opportunity with the same name → expect
   *"#… already exists — link it instead."*
3. Open a project at `/projects/[id]` → **Slack channel → Create or link** → Create →
   confirm the channel is **public** and named `#l-project-<project-slug>`.
4. Rename an unlinked project to match an existing public channel → reload → the
   suggestion line offers it → **Link** → toast, row populates.
5. **Link** an existing public channel via search; then try the same channel on a second
   record → expect the already-linked rejection.
6. Private-channel guidance (opportunity surface): search for a private channel the bot
   isn't in → no result + the `/invite` notice. `/invite @<App>` in Slack, wait out or
   bust the 1h cache, search again → it appears.
7. **Unlink** on both surfaces → confirm dialog copy, toast, row returns to empty, and
   the channel still exists in Slack.
8. Sign in as a `sales`-only user → the opportunity's scoping row is fully usable and the
   project page's Slack row is read-only. As `delivery-manager`-only → the inverse.

Please paste the output of anything that misbehaves in steps 1–8 and I'll debug from
there.

## Out of scope

No Slack messages posted, no Events API, no slash commands, no webhook route handler, no
channel archiving on project close, no per-user OAuth, and no background sync of channel
renames — the stored name is a snapshot and the link is by id, so a rename never breaks
the hyperlink.

Also deliberately out: **managing a project's channel from the opportunity drawer.** Each
record owns its own slot. A project reached by several opportunities would otherwise have
an ambiguous owner for the control, and a `sales`-only user would see a permanently
disabled button. If a hand-off view later wants both channels side by side, that's a
read-only display, not a second write surface.

Also out: **carrying the scoping channel over when a project is created from an
opportunity.** Tempting, but they're different channels with different visibility and
different members — the project channel gets created on the project surface when delivery
starts.
