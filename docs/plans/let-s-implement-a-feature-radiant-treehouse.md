# Delivery notes on a project, with project health on the list

## Context

Today a project's "how is this actually going?" is nowhere in the system. The plan tells
you what was sold and staffed, the margin tells you whether it should be profitable, and
the timeline tells you when it ends — but nothing captures the delivery manager's own
read on the engagement, and nothing surfaces a project that is quietly going badly.

This adds **delivery notes**: a dated write-up a delivery manager attaches to a project
(title, date, notes, and a 1–10 **project health** rating), plus the two list-level
consequences — health as a metric on the project card, and a **Low health** risk tag when
the latest rating is at or below the floor.

Health lives on the note, not as a column on `projects`. A project's health is a
point-in-time judgement with a narrative attached, so it is a *document* (the
`performanceReviewNote` / `staffSelfEvaluation` shape), and the list metric is *derived*
from the latest note — the same "derive it, don't store it" call ADR 0033 made for project
status and line of business. A `projects.health` scalar would be a hand-maintained
duplicate of the newest row that silently disagrees with it the moment a note is edited.

### Decisions already settled

1. **Write gate:** static `permission: { projects: ["edit"] }` — held by `delivery-manager`,
   `manager`, `admin`. No new capability, so `permissions.ts`, `permissions.test.ts` and
   the matrix table in `docs/domains/permissions.md` are **untouched** (prose only).
   Reads stay open, like every other project read.
2. **Health input:** reuse `src/components/form/star-rating.tsx` with `max={10}` — its
   `max` is already a prop. (Note: `relationshipStrength` is a 1–5 scale; this is the same
   control at ten points.)
3. **List metric:** the **latest** note's health (latest `noteDate`, `createdAt` breaking a
   tie). No notes ⇒ "Not rated" and **no flag** — "we can't tell" is not "it's bad", the
   rule `project-flags.ts` already states for withheld margin.
4. **Edit/delete:** the same gate as create, *not* author-only. A delivery note is the
   operational record of a shared engagement, so the team that runs it can correct it.
   `authorStaffId` is attribution only and is never an authorization input.

---

## 1. Two pure scale/constant modules

**`src/lib/projects/project-health.ts`** (new) — the ADR 0016 pure-scale shape, copied from
`src/lib/crm/relationship-strength.ts`. No `db`/drizzle/UI imports: it is read by
`project-flags.ts` (server), the zod schema, the star input and the card.

- `PROJECT_HEALTH_MIN = 1`, `PROJECT_HEALTH_MAX = 10`, a levels tuple, `ProjectHealth` type.
- `PROJECT_HEALTH_LABELS` — ten **distinct** labels: Critical / Failing / At risk /
  Struggling / Mixed / Fair / Steady / Healthy / Strong / Exemplary.
- `projectHealthLabel(value: number | null)` → the label, `"Not rated"` for null, `"—"` for
  out of range.
- Header comment: why ten points and not five (a five-point scale collapses the whole
  interesting middle — "fine but watch it" and "actually wobbling" land on the same star).

**`src/lib/projects/delivery-note.ts`** (new) — mirrors `src/lib/performance/review-note.ts`:
`DELIVERY_NOTE_TITLE_MAX = 200`, `DELIVERY_NOTE_BODY_MAX = 20_000`. Separate from the scale
module because the scale is a shared *vocabulary* that `project-flags.ts` imports, and
`project-flags.ts` has no business knowing a note's text limits.

**The low-health threshold goes in `project-flags.ts`, not the scale module.** The two answer
different questions on different cadences: `project-health.ts` answers *"what does a 4
mean"* (vocabulary, client-bundled); `project-flags.ts` answers *"what counts as trouble"*
(policy). The flags module already argues exactly this in its header, already houses
`LOW_MARGIN_PERCENT` / `NEGATIVE_MARGIN_AT_OR_BELOW`, and carries `PROJECT_FLAGS_REVIEWED_ON`
— a threshold whose review stamp lives in another file is how the stamp becomes a lie.

**`LOW_PROJECT_HEALTH_AT_OR_BELOW = 4`, inclusive.** 5 would flood the badge row (the
midpoint is literally "Mixed" — where a DM parks something they can't call either way, and
ADR 0057 reserves badges for warnings). 3 says nothing you didn't know (a 1–3 project is
already being escalated in a standup). 4 is the highest rating unambiguously below the
middle, and maps onto the bottom four labels, each of which is a sentence you'd want on a
card. Also **bump `PROJECT_FLAGS_REVIEWED_ON`** — the module instructs you to.

## 2. The Drizzle table

Append `projectDeliveryNotes` to **`src/lib/db/projects-schema.ts`** (already barrel-exported
via `src/lib/db/schema.ts`; `staff` is already imported there, so only `integer` is a new
`pg-core` import). Add `export type ProjectDeliveryNote = InferSelectModel<...>` to the
`// --- Row types ---` block. Id prefix **`pdn`** (`generateId("pdn")`), beside `project` /
`pdm` / `role`.

| column | type | notes |
|---|---|---|
| `id` | `text().primaryKey()` | |
| `projectId` | `text().notNull()` → `projects.id` **cascade** | a note is meaningless without its engagement |
| `authorStaffId` | `text()` → `staff.id` **set null** | attribution only |
| `noteDate` | `date().notNull()` | the date the note is *about*; `createdAt` is when it was typed |
| `title` | `text()` (nullable) | panel falls back to the date, like the review-notes panel |
| `body` | `text().notNull()` | |
| `projectHealth` | `integer().notNull()` | own column, not jsonb |
| `createdAt` / `updatedAt` | `timestamp()` + `$onUpdate` | standard |

**Index:** `index("project_delivery_notes_project_date_idx").on(t.projectId, t.noteDate.desc(), t.createdAt.desc())`.
The `.desc()` is load-bearing, not decoration: both readers want `project_id ASC,
note_date DESC, created_at DESC`, and a plain ascending btree cannot serve a *mixed*
direction — Postgres can only walk an index backwards for a wholly reversed ordering, so
you'd get a Sort node.

**Check constraint:** `check("project_delivery_notes_health_range", sql\`${t.projectHealth} between 1 and 10\`)`
— the scale as a DB invariant, so an out-of-range value can't reach the flag from a future
import. Mirrors `projects_budget_shape`. Not a `pgEnum`: a numeric rating in a pgEnum stores
strings and needs `ALTER TYPE` to widen the scale.

**`authorStaffId` (→ `staff`) not `authorUserId` (→ `user`).** The two precedents differ for
a reason and this falls on the CRM side. `performanceReviewNote.authorUserId` points at
`user` because there the author *is an authorization input* (the mutate hook compares it to
`ctx.user.id`). Decision 4 removes that here, so what's left is `contactEntries.authorStaffId`'s
case exactly — and it buys the right display (`staff.name`, linkable to `/staff/[id]`, the
name every other project surface shows). Accepted cost, the same one CRM accepts: a
signed-in admin with no `staff` row writes an unattributed note.

**`projectHealth` is `notNull`.** It makes the list rule statable in one sentence ("the
latest note's health") — a nullable rating forces a look-further-back clause nobody wants
to explain or test. `staffSelfEvaluation.selfRating` is `notNull` for the same stated reason
(ADR 0058), and `StarRating` has no clear affordance anyway, so a null would be unreachable
from the only UI that writes it.

## 3. Migration + seed

Ordering is load-bearing — the seed imports the real table, so `tsc` won't typecheck seed
edits written before it exists.

```
bun run db:generate      # → drizzle/0021_*.sql — then READ it
bun run db:migrate
```

In the generated SQL confirm the `CHECK ... BETWEEN 1 AND 10` survived and the index reads
`(project_id, note_date DESC, created_at DESC)`. A flattened index or dropped check is
invisible until production data arrives. No backfill — new table, nothing references it.

**`scripts/seed/wipe.ts`** — add `"project_delivery_notes"` to `SEEDABLE_TABLES` in the
`// projects` block, above `"project_roles"` (the list is documented child→parent).

**`scripts/seed/projects.ts`** — add a second export `seedProjectDeliveryNotes(db, projects, staff)`
to the existing file (the `scripts/seed/performance.ts` precedent exports five from one
module); it needs only `projects` + `staff`, both already imported. Import
`LOW_PROJECT_HEALTH_AT_OR_BELOW` and `PROJECT_HEALTH_MIN`/`MAX` rather than hardcoding
4/1/10 — that's the drift guard `AGENTS.md` describes.

Force the first four projects rather than leaving them to chance; each is a rule the list
must obey:

| index | notes | asserts |
|---|---|---|
| 0 | **none** | "Not rated" **and no badge** |
| 1 | latest health = `LOW_PROJECT_HEALTH_AT_OR_BELOW` | badge fires at the inclusive boundary |
| 2 | latest health = threshold + 1 | badge does *not* fire one above |
| 3 | two notes on the **same `noteDate`**, `MIN` then `MAX`, increasing `createdAt` | the tie-break decides; no badge |
| rest | ~65% coverage, 1–4 notes, weighted health skewed high | ordinary spread |

**Gotcha:** set `createdAt` explicitly. `defaultNow()` is `now()`, which is *transaction*-scoped
in Postgres, so every row in one bulk insert gets an identical `created_at` and the tie-break
fixture becomes undefined. Use `new Date(parseIsoDate(noteDate).getTime() + i * 60_000)`
(`parseIsoDate` from `@/lib/format/format`, already used this way in `scripts/seed/performance.ts`).

**`scripts/seed.ts`** — call it after `seedProjects` and add the count to the `console.table`.

## 4. Schema + actions (`src/actions/projects/`)

**`deliveryNotes.schema.ts`** — hand-written `z.object`, **drizzle-free** (the form imports
it; `createInsertSchema` would pull the table into the client bundle, ADR 0035). Header-comment
it as a pure client-importable module. A shared `deliveryNoteFields` object spread into create
and update, exactly as `selfEvaluations.schema.ts` / `reviewNotes.schema.ts` do:

- `noteDate: dateString` (`@/lib/schemas/date-schema`)
- `title: optionalText(DELIVERY_NOTE_TITLE_MAX, ...)` — `optionalText` not `optionalTrimmedText`,
  so an already-null title round-trips back to the action without failing re-validation
- `body: requiredText(DELIVERY_NOTE_BODY_MAX)`
- `projectHealth: z.number({ message: "Rate the project's health." }).int().min(PROJECT_HEALTH_MIN, ...).max(PROJECT_HEALTH_MAX, ...)`
  — bounds from the scale module so they can't drift from the DB check

Export `deliveryNoteContentSchema` (the form resolver) plus `createProjectDeliveryNoteSchema`
(`{ projectId: id, ...fields }`), `updateProjectDeliveryNoteSchema` (`{ noteId: id, ...fields }`),
`deleteProjectDeliveryNoteSchema` (`{ noteId: id }`), and both `z.input`/`z.output` types for
the content schema (blank title → null). Deliberately absent: `authorStaffId` (session-resolved)
and `projectId` on update (a note can't be moved).

**Three mutation files**, all `permission: { projects: ["edit"] }` in `.metadata`, all
ending in `revalidateProject(projectId)` from `src/actions/projects/revalidate.ts`:

- `createProjectDeliveryNote.ts` — `resolveAuthorStaffId(ctx.user)` → `generateId("pdn")` →
  insert, wrapped in the `isForeignKeyViolation` → `UserSafeActionError("That project no
  longer exists.")` try/catch that `src/actions/crm/entryMutations.ts` uses (the FK is the
  guard, so no pre-read).
- `updateProjectDeliveryNote.ts` — sets only the four content columns, `.returning({ projectId })`,
  `assertRowExists(rows, "delivery note")`. Doc-comment that `authorStaffId` is never touched:
  the gate isn't author-only, so an editor is usually *not* the author and the note keeps
  saying who wrote it.
- `deleteProjectDeliveryNote.ts` — same shape with `db.delete`.

**`resolveAuthorStaffId` must move** from `src/actions/crm/resolveAuthorStaffId.ts` to
**`src/actions/shared/resolveAuthorStaffId.ts`** (that folder exists for this —
`assertRowExists.ts`, `staffHourlyCost.ts`), updating its two importers
(`src/actions/crm/entryMutations.ts`, `src/actions/crm/createTask.ts`). It's domain-agnostic;
a projects action importing `@/actions/crm/*` for a session helper is the wrong shape.

**`getProjectDeliveryNotes.ts`** — a plain `import "server-only"` read (not an action).
Returns a bare `ProjectDeliveryNoteRow[]` (id, noteDate, title, body, projectHealth,
authorName, authorStaffId, createdAt, updatedAt) with a **left** join to `staff` (an inner
join would silently drop notes whose author's staff row is gone). Export the shared order
clause so the list and the detail page can never disagree about which note is current:

```ts
export const latestDeliveryNoteFirst = [
  desc(projectDeliveryNotes.noteDate),
  desc(projectDeliveryNotes.createdAt),
];
```

A bare array, not a `...View` object: `getStaffReviewNotes` returns `{ canCreate, ... }`
because *who sees what* varies per row there. Here reads are open and the page already
computes `canEdit`, so a `canCreate` in the read would be a second source for one boolean.
`Date` objects rather than `EntryView`'s epoch millis, matching `ReviewNotesPanel`, which
already receives `Date`s and tests `updatedAt > createdAt` for its "edited" marker.

## 5. Projects list

**`src/actions/projects/getProjectsList.ts`** — two new `ProjectListItem` fields after
`endDate`: `latestHealth: number | null` and `latestHealthDate: string | null`. Carrying the
date is deliberate — the badge can be driven by a note that's a year old, and a bare "3/10"
on a card reads as *now*. Unlike `margin`, health is **not** capability-gated: a health
rating is a delivery judgement, nothing derived from compensation.

In `assembleRows` add **one** scoped query — `DISTINCT ON`, not fetch-and-reduce:

```ts
const healthRows = await db
  .selectDistinctOn([projectDeliveryNotes.projectId], { projectId, projectHealth, noteDate })
  .from(projectDeliveryNotes)
  .where(inArray(projectDeliveryNotes.projectId, ids))
  // DISTINCT ON requires its own expressions to lead the ORDER BY.
  .orderBy(asc(projectDeliveryNotes.projectId), ...latestDeliveryNoteFirst);
```

then a `Map` lookup in the existing `baseRows.map(...)`, and feed `latestHealth` into the
`projectFlags({ ... })` call (~line 336). Both approaches are *correct*; the difference is
payload growth. `getStaffDirectory` reduces in JS and its own comment anticipates this case
("if the history grows large, switch to a `DISTINCT ON`") — an employment history is a
handful of rows per person forever, while a note-per-week over a two-year engagement is
~100 rows per project, and the unpaginated Active section can hold every live project at
once. `DISTINCT ON` returns at most one row per project regardless, and keeps `assembleRows`'
documented no-N+1 contract (a lateral/correlated subquery would not).

Optional cheap win: `Promise.all` this query with the existing manager query. Leave
`getProjectsMarginContext` and `roleRows` sequential — the role loop reads `costBasis`.

**`src/lib/projects/project-flags.ts`:**

- `PROJECT_FLAGS = ["negativeMargin", "lowHealth", "lowMargin", "endingSoon"]` — `lowHealth`
  **second**, worst-first. A loss is money already being lost, machine-derived and
  unarguable; a low health rating is the person running the engagement saying it's going
  badly, which outranks a thin-but-positive margin and a date.
- `PROJECT_FLAG_LABELS.lowHealth = "Low health"`; `PROJECT_FLAG_VARIANTS.lowHealth = "secondary"`
  (the module's convention reserves `destructive` for the loss — a computed fact about
  money; a 1–10 score is a human judgement that may be stale).
- `ProjectFlagInputs` gains **required** `latestHealth: number | null`. Required, not
  optional: an optional field silently degrades to "no tag" for a caller that forgets it,
  with no compiler complaint. Making it required means the type-error list *is* the to-do
  list (`getProjectsList.ts` + `project-flags.test.ts`).
- Predicate: `isLive(input) && input.latestHealth != null && input.latestHealth <= LOW_PROJECT_HEALTH_AT_OR_BELOW`.
  `isLive` first — a cancelled project's last health note describes work nobody still has to do.

**`src/components/projects/project-card.tsx`** — the badge row needs **no change** (it already
maps `project.flags` through the label/variant records). Add one `CardField label="Health"`
inside the `<dl>`, after `Dates` and before the `Margin` block, rendering
`{latestHealth}/{PROJECT_HEALTH_MAX}` in `tabular-nums` with the note date muted beside it,
or `Not rated` in `text-muted-foreground`.

Rendered as **text, not stars.** The card is wrapped in a `<Link>` and `StarRating`'s
interactive mode is a `fieldset` of buttons — nesting those in a link is an accessibility
problem — while its read-only mode still emits ten icons per card across a whole grid. The
number carries the same information; the words live on the detail page.

## 6. Project detail page

**`src/app/(app)/projects/[id]/page.tsx`** — add `getProjectDeliveryNotes(id)` to the
existing `Promise.all` and pass `notes` to `ProjectDetailView`. A **separate server-only
read**, not an extension of `ProjectDetailPlan`, because: `generateMetadata` also calls
`getProjectPlan(id)`, so anything added there is fetched twice per request just to title the
tab; `getProjectPto(id)` already feeds a sibling tab exactly this way; and
`ProjectDetailPlan` is a *shared* shape (it also feeds the opportunity drawer's planner),
so a project-only concern doesn't belong in it. No new revalidate wiring —
`revalidateProject` already hits `/projects/${projectId}`.

**`src/components/projects/detail/project-detail-view.tsx`** — a fourth tab in the existing
`<Tabs defaultValue="timeline">`, ordered **Timeline | Roles | Delivery notes | Time off**
(structural tabs first, narrative ahead of ancillary PTO). Inside, `DetailSection
title="Delivery notes" count={notes.length} action={newNoteButton}` — the same
`src/components/crm/detail-parts.tsx` primitive the Roles tab uses.

**`src/components/projects/detail/delivery-notes-panel.tsx`** (new) — `DeliveryNotesPanel({ projectId, notes, canEdit })`
with a local `DeliveryNoteForm` in the same file. Structurally
`src/components/performance/review-notes-panel.tsx`: inline form (not a dialog), one form
component serving create *and* edit via a props union so "neither" can't be constructed,
loose `useForm` + `useAction` binding, `ConfirmDialog` for delete, `EmptyState bordered`,
`router.refresh()` after each change. No `onChanged` escape hatch — there's no client-fetched
drawer host here.

Fields: `noteDate` (`Controller` + `DatePicker`, defaulting to `formatIsoDate(new Date())`)
beside optional `title`, then `projectHealth`, then `body` (`Textarea rows={10}`). The health
field wraps `StarRating` in a `Controller` with `max={PROJECT_HEALTH_MAX}` and
`onPreviewChange` driving a `projectHealthLabel(preview ?? value)` line beneath — lifted
from `src/components/crm/inline-relationship-strength-field.tsx`, which is what makes a
ten-point scale legible while you hover.

**The one place types will fight you.** `deliveryNoteFields.projectHealth` is `z.number()`,
so `z.input<>` says `number` — but the create form must start *unrated* and `StarRating`
wants `number | null`. Don't cast; declare the form values type explicitly and use the
three-generic `useForm` (the transformed shape as the third generic, as `ReviewNoteForm`
does), so `handleSubmit` hands the action exactly what it takes:

```ts
type DeliveryNoteFormValues =
  Omit<DeliveryNoteContentInput, "projectHealth"> & { projectHealth: number | null };
useForm<DeliveryNoteFormValues, unknown, DeliveryNoteContentValues>({ ... });
```

Record rendering: the title, or `formatDate(note.noteDate)` when untitled; a `" · "`-joined
muted meta line (date when titled, `by {authorName}` as an `InternalLink` to `/staff/[id]`
when `authorStaffId` is set, `edited` when `updatedAt > createdAt`) — the review-notes
panel's exact idiom; the health as `StarRating readOnly` plus its label; then
`<p className="text-sm whitespace-pre-wrap">{note.body}</p>`.

**A health `StatCard` joins `PlanSummaryTiles` via a new optional prop**, not a sibling tile.
`src/components/projects/plan-summary-tiles.tsx` already has this pattern (`deliveryManagers?`
renders only on the surface that wants it), and it owns the `grid sm:grid-cols-2 lg:grid-cols-3`
wrapper, so a sibling `StatCard` would break the grid. The opportunity surface simply omits
the prop. `ProjectDetailView` derives the value from `notes[0]` — the read is already ordered
latest-first, which is why `latestDeliveryNoteFirst` is shared with the list's `DISTINCT ON`.
**Verify the icon name** (`IconHeartbeat` or similar) is exported by this version of
`@tabler/icons-react` before committing to it.

## 7. Tests

Pure-lib only, per ADR 0037 — `src/lib/projects/` already has four such files.

**`src/lib/projects/project-flags.test.ts`** — the `inputs()` helper gains
`latestHealth: PROJECT_HEALTH_MAX` so the healthy baseline stays healthy (making the field
required means the compiler points straight here). New `describe("low health")`, with cases
expressed **relative to the constant** (the file's stated rule):

- trips **at** `LOW_PROJECT_HEALTH_AT_OR_BELOW`, does **not** trip at `+ 1`, trips at `PROJECT_HEALTH_MIN`
- `latestHealth: null` → `[]` (the "Not rated is not bad" rule)
- `status: "cancelled"` + low health → `[]`
- low health with **withheld margin** (`margin: null`) still flags → pins the deliberate
  asymmetry so nobody "fixes" it
- extend the ordering test: negative margin + low health + ending soon →
  `["negativeMargin", "lowHealth", "endingSoon"]`
- one invariant: the threshold is `>= PROJECT_HEALTH_MIN` and `< PROJECT_HEALTH_MAX`

**`src/lib/projects/project-health.test.ts`** (new) — `projectHealthLabel(null) === "Not rated"`;
every level has a non-empty label and the ten are **distinct**; out-of-range → `"—"`;
`PROJECT_HEALTH_MAX === 10` (pins a contract three other places encode independently: the
DB check, the form's `max`, the card's denominator).

## 8. Docs

Dispatch the **`librarian`** subagent (per `AGENTS.md`) rather than hand-writing these.
Hand it: `docs/domains/projects.md` (a new `## Delivery notes` section, the entity in
`## Key entities`, the `lowHealth` flag rule, the **health carve-out** to the "which flags
you see depends on your capability" bullet — which otherwise becomes false, the fourth tab
and health tile, the three new actions under `## Authorization`, and two open questions:
stale health and health as a sort/filter); `docs/data-model.md` (the realized-migrations
line, `project_delivery_notes` in the Projects slice, latest-note health under
`## Key derived concepts`); `docs/domains/permissions.md` (**prose only** — the
`projects.edit` bullet; the matrix is untouched); and `AGENTS.md`'s "Built:" paragraph.

**An ADR is warranted — `docs/decisions/0059-*`** (confirm the next number against
`docs/decisions/README.md`, not `ls`). Four decisions are non-obvious and one *inverts* a
recent ADR: health-as-a-document not a column; the rating as a typed integer column rather
than jsonb or a pgEnum (ADR 0058's reasoning plus the numeric-scale point); **writes gated
on static `projects.edit` with edit/delete NOT author-only** — the deliberate departure from
ADR 0058, argued from the difference between a person's own words about themselves and the
operational record of a shared engagement; and the list metric/flag rules including the
visible-to-everyone asymmetry.

## 9. Verification

```
bun run db:generate && bun run db:migrate    # read drizzle/0021_*.sql first
bun run db:seed --yes
bun run check                                # Biome + tsc --noEmit + bun test
bun run build
```

Then `/code-review` and `/audit-rbac` before claiming done.

**Manual click-path** (`bun run dev`):

1. `/projects` as admin — the seeded fixtures: a card at `4/10` with a **Low health** badge;
   one showing `Not rated` with **no** badge; one at `5/10` with **no** badge; the same-date
   pair resolving to the later-created note's health.
2. Open a project → **Delivery notes** → **New note** → date, title, click 8 stars (the label
   word should track the hover, then commit), body → Save. Expect a toast, the note at the
   top of the log, the **Health** StatCard at `8/10`, and `/projects` showing the new figure.
3. **Edit** it down to 3 → the badge appears on the card without a hard reload.
4. **Delete** it → the project falls back to the previous note, or to `Not rated` with no badge.
5. Add a second note dated the **same day** with a different health → both surfaces agree on
   the later-created one.
6. Validation: submit with no stars ("Rate the project's health.") and with an empty body.
7. **Gate check** — as `sales` or `user` (via the admin manage-users surface): the tab renders
   read-only, no **New note**, no edit/delete. The metadata gate runs before the body, so the
   affordance flag is not the boundary.
8. **Margin cross-check** — as `sales` (no `projects.viewMargin`): the Margin field is absent
   but **Health is present and the badge still fires**. That asymmetry is intended.

## Ordering constraints & known hazards

1. **Sequence:** scale/constant modules → table → `db:generate` → `db:migrate` → flags module
   → schema/actions → seed → UI. The seed and actions both import the table; the flags test
   and `getProjectsList` both break the moment `ProjectFlagInputs` gains a required field —
   intentionally, that's the to-do list.
2. **Bump `PROJECT_FLAGS_REVIEWED_ON`.** The date is what tells a reader how much to trust a tag.
3. **Transaction-scoped `now()` in the seed** — set `createdAt` explicitly or the tie-break
   fixture is undefined.
4. **No drizzle-zod in `deliveryNotes.schema.ts`** — the form imports it (ADR 0035).
5. **`resolveAuthorStaffId` moves** to `src/actions/shared/`; two CRM import sites to update.
6. **`StarRating` must not go inside the card's `<Link>`** — the panel and the tile may use it.
7. **The mixed-direction index** is the difference between an index scan and a Sort; `.desc()`
   on index columns is supported but easy to forget and easy for a later `db:generate` to drop.
8. **`assembleRows` runs 5× per grouped page render** — same multiplier the existing manager
   and role queries already pay, but that's where anything else per-project lands too.
9. **Stale health is real and unaddressed:** a **Low health** badge can be driven by a
   year-old note. That's why `latestHealthDate` ships to the card. A `staleHealth` flag (or
   suppressing `lowHealth` past N days) is the obvious next threshold decision — record it as
   an open question rather than half-building it.
