# 0059 — Project delivery notes: health as a dated document, the list metric derived from the latest note, writes on static `projects.edit` (not author-only)

**Status:** accepted · 2026-07-31 · same "derive it, don't store it" call as
[ADR 0033](./0033-line-of-business-on-role-derived-project-status.md) (project status ⁄ LoB)
and [ADR 0034](./0034-company-status-derived-tags.md) · reuses
[ADR 0058](./0058-self-evaluations-dated-records-with-snapshotted-answers.md) §3's
typed-column reasoning for the rating while **deliberately inverting** its §5 author-only
write rule · extends [ADR 0057](./0057-projects-list-margin-and-derived-flags.md)'s flag
machinery with a **fourth** tag and its first **ungated** input · **no matrix change** ·
**still current under [ADR 0061](./0061-projects-list-as-a-sortable-table.md)**, which moved the
list from cards to a table: the "Low health" tag stays deliberately **monochrome**, which is why
0061's ten-segment health bar is uncoloured too — read "the card's Health field" below as "the
table's Health column"

## Context

The projects domain could say what an engagement *costs* and what it *earns* (ADR 0053), and
`/projects` could tag the ones losing money or ending soon (ADR 0057). It had no way to record
the thing a delivery lead actually knows and nobody else can compute: **how the engagement is
going.** A project three weeks from a renewal, at 40% margin, with a client who has stopped
answering, looked identical on the list to a healthy one.

That judgement is not derivable from any table we hold — it needs a person to state it, dated,
with the reasoning attached. Two questions had to be answered together: **where a
point-in-time judgement lives** in a schema whose projects deliberately store almost nothing
of their own, and **who may write and correct one** in a domain where every other write is one
flat capability while the most recent comparable slice (self-evaluations, ADR 0058) is
author-only with no override.

## Decision

### 1. Health lives on a dated note, not as a column on `projects`

`project_delivery_notes` (`src/lib/db/projects-schema.ts`,
`drizzle/0021_special_doctor_spectrum.sql`): `projectId` (cascade) · `authorStaffId`
(→ `staff`, `set null`) · `noteDate` (`date`, the date the note is *about*) · `title`
(nullable) · `body` · `projectHealth` (`integer`, notNull) · timestamps. Id prefix `pdn`.

A health rating is a **point-in-time judgement with a narrative attached** — the same category
as `performance_review_note`: a *document*, where nothing supersedes anything and two notes
coexist forever. `projects` therefore gains **no `health` column**. "How is this project doing"
is answered by the **latest note** (§4), exactly as `projects.status` and
`projects.lineOfBusiness` are answered by the roles (ADR 0033) and a company's Client/Partner
tags by its opportunities (ADR 0034).

A `projects.health` scalar would be a hand-maintained duplicate of the newest row, and it would
start disagreeing with it the first time a note is edited or deleted — with no way to tell which
of the two lied. The derived version is self-healing: deleting the newest note *is* how a
project's list health falls back to the one before it (the delete confirmation says so).

The index is `(project_id, note_date DESC, created_at DESC)`. **The mixed direction is
load-bearing, not decoration** — it serves both readers in the exact order each wants (the
detail log, and the list's `distinct on (project_id)`), and Postgres can only walk a btree
backwards for a *wholly* reversed ordering, so a plain ascending index would force a sort node.

### 2. The rating is a typed integer column — not jsonb, not a pgEnum

`projectHealth integer notNull`, with a DB **check constraint**
(`project_delivery_notes_health_range`, `between 1 and 10`) whose bounds are interpolated from
the scale module via `sql.raw` — a bare `${number}` would emit a bind parameter, which a check
constraint can't carry.

Its own column for ADR 0058 §3's reasons, applied again: it is the only part of a note with a
**closed value set** (so the DB can constrain it), the only thing anything aggregates on, and
**the one value a list row must badge without parsing jsonb**. `notNull` keeps the list's rule
statable in one sentence ("the latest note's health") — a nullable rating would force a
look-further-back clause nobody wants to explain or test — and it is unreachable from the only
UI that writes it, since `StarRating` has no clear affordance.

**Not a pgEnum**, which is where this parts company with `selfRating`: a pgEnum stores *strings*,
so a numeric scale in one would need an `ALTER TYPE` to widen (11 points, or half steps) and
would compare and sort as text. A check constraint moves with a code review of the scale module.

The scale itself is a pure, client-importable module (`src/lib/projects/project-health.ts`,
ADR 0016 shape): `PROJECT_HEALTH_MIN`/`MAX` (**1–10**), ten distinct labels
(Critical → Exemplary), `projectHealthLabel()`, and `PROJECT_HEALTH_UNRATED_LABEL`
("Not rated"). **Ten points, not `relationshipStrength`'s five**, because this is a judgement
people already voice as "a seven" and five points collapse the interesting middle — "fine but
watch it" and "actually wobbling" would land on the same star. The accepted cost is that no two
adjacent labels differ much; the labels read as a band, not a verdict. Note limits live
separately in `src/lib/projects/delivery-note.ts`, and the *policy* ("what counts as trouble")
lives in `project-flags.ts` (§4) — three modules because they are revised on three cadences.

### 3. Writes are the static `projects.edit` capability, and edit/delete are **not** author-only

`createProjectDeliveryNote` / `updateProjectDeliveryNote` / `deleteProjectDeliveryNote` all
declare `permission: { projects: ["edit"] }` and **nothing else** — no `authorize` hook, no
ownership dimension. Reads (`getProjectDeliveryNotes`) are open like every other project read:
no user argument, no mask, no `canCreate` flag in the payload (who may write is the static
capability the page already computes as `canEdit`).

**This deliberately inverts ADR 0058 §5**, and the inversion has to be argued from the
difference between the two documents rather than from convenience:

- A **self-evaluation** is a person's own words about themselves. Authorship *is* the point, and
  a third-party edit — with no separate author column to expose it — would be putting words in
  someone's mouth undetectably. Hence author-only, with no admin override.
- A **delivery note** is the **operational record of a shared engagement**. The delivery manager
  who wrote last week's note may be on leave, may have rolled off, or may simply have typed the
  wrong date; the team that runs the engagement has to be able to correct its own record. An
  author-only rule would leave a wrong health rating driving a badge on the list with nobody
  able to fix it. This is the same "no per-entry ownership, shared team log" call CRM notes and
  tasks made (ADR 0030 / ADR 0043) — a delivery note is that, with a number on it.

**Consequence, stated so it can't be mistaken for an oversight:** `authorStaffId` is
**attribution only and never an authorization input.** That is why it points at **`staff`**
(matching `projectRoles.staffId` — and, at the time, the since-dropped
`projectDeliveryManagers.staffId`, [ADR 0068](./0068-delivery-managers-as-project-roles-and-coverage-gaps.md) — so the panel can link the
name to `/staff/[id]`) rather than at `user` as `performanceReviewNote.authorUserId` does — a
column that decides access must identify the *account*, one that only says "who wrote this" is
better off as the person. `set null` on the author's staff row disappearing therefore narrows
nothing, and a signed-in user with no staff row (an admin) writes an **unattributed** note — the
cost CRM entries already accept. `updateProjectDeliveryNote` never touches `authorStaffId`
(an editor is usually *not* the writer, and the note should keep saying who wrote it) and never
touches `projectId` (a note belongs to the engagement it was written about).

The author is resolved server-side from the session via `resolveAuthorStaffId`, which **moved
from `src/actions/crm/` to `src/actions/shared/`** for this — it now has consumers in two
domains.

### 4. The list metric and the fourth flag

`ProjectListItem` gains **`latestHealth`** and **`latestHealthDate`**, from a
`selectDistinctOn([projectId])` query in `assembleRows` ordered by `projectId` then the
**shared `latestDeliveryNoteFirst`** clause exported by `getProjectDeliveryNotes` — one
ordering rule, two readers, so the list's figure and the top of the detail log can never
disagree about which note is current. It was the **third** grouped follow-up query there,
`Promise.all`'d with the delivery-manager one — **that sibling is gone
([ADR 0068](./0068-delivery-managers-as-project-roles-and-coverage-gaps.md)), so this is now
one of two and runs unaccompanied**; `distinct on` rather than pulling every note
back and reducing in JS, because a weekly note over a two-year engagement is ~100 rows and the
unpaginated Active section can hold every live project at once.

- **Latest = `(noteDate, createdAt)` descending.** The author-chosen date decides; `createdAt`
  breaks a same-day tie. The seed forces that tie-break case on purpose.
- **No notes ⇒ "Not rated", and no flag.** This extends ADR 0057's rule: "we can't tell" is not
  "it's bad". Deliberately not a dash and not "Poor" — nobody has assessed it yet, which is a
  different statement from an assessment that came back badly.
- **`lowHealth` fires at `LOW_PROJECT_HEALTH_AT_OR_BELOW = 4`, inclusive**, on live projects
  only (`isLive` — a cancelled project's last note describes work nobody still has to do).
  **Four, not five:** the midpoint of a 10-point scale is where a lead parks an engagement they
  can't call either way — its label is literally "Mixed" — and flooding the badge row destroys
  the row (ADR 0057 §7). **Not three,** either: a project rated 1–3 is already being escalated
  in a standup, and a list tag earns its keep on the population that is *quietly* not going
  well. Four is the highest rating unambiguously below the middle, and it maps onto the four
  labels each of which is a sentence you'd want on a card.
- **Placed second in `PROJECT_FLAGS`** (after `negativeMargin`, before `lowMargin` — and, since
  [ADR 0068](./0068-delivery-managers-as-project-roles-and-coverage-gaps.md), before
  `noDeliveryManager`, which ranks *below* health on this same argument: an uncovered period is a
  *risk* of trouble where a low rating is a report of it): a loss is
  money we are already losing, but the person running the engagement saying it is going badly
  outranks a thin-but-positive margin and an approaching end date. Variant **`secondary`**, not
  `destructive` — a 1–10 score is a human judgement that may be stale, where a loss is a
  computed fact. A coloured tier, if ever wanted, is a second `criticalHealth` flag suppressing
  this one, exactly as `negativeMargin` suppresses `lowMargin`.
- **`latestHealth` is required on `ProjectFlagInputs`, not optional** — an optional field would
  silently degrade to "no tag" for a caller that forgot it, with no complaint from the compiler.

**The asymmetry worth internalising: health flags are visible to every viewer, margin flags are
not.** ADR 0057 withholds `margin` (and therefore every margin-derived tag) from anyone without
`projects.viewMargin`, because a role's cost *is* an individual's compensation. A health rating
is a **delivery judgement typed by a human** — nothing about it is derived from anyone's pay —
so it is shipped to everyone, and `lowHealth` is the first flag a `user` or `sales` reader can
see besides `endingSoon`. `PROJECT_FLAGS_REVIEWED_ON` moves to `2026-07-31`.

### 5. No capability was added

`src/lib/auth/permissions.ts`, `src/lib/auth/permissions.test.ts` and **the canonical matrix
table in [permissions.md](../domains/permissions.md) are all untouched** — ADR 0014's lockstep
rule is not engaged. A `projects.deliveryNotes` capability would be a second way to say
`projects.edit`: the audience for "may correct the delivery record of an engagement" is exactly
the audience for "may re-date its roles". permissions.md carries **prose** on the `projects.edit`
bullet instead.

## Consequences

- **A `Low health` badge can be driven by a stale note.** Nothing expires a rating, so a project
  whose last note is a year old still badges (or still reads healthy) on today's list. That is
  why **`latestHealthDate` ships alongside the figure** and both the card and the detail tile
  render the date beside the number — a bare "3/10" reads as *now*. A `staleHealth` flag or a
  recency cutoff on `lowHealth` is the obvious next threshold decision and is **deliberately not
  built**: it needs a policy answer ("how old is too old"), not code. See
  [projects.md](../domains/projects.md#open-questions--not-yet-built).
- ~~**Health can't be sorted**~~ — **superseded by
  [ADR 0061](./0061-projects-list-as-a-sortable-table.md) §3–4**, which put the latest-note lookup
  in the base query as the correlated scalar subquery `latestHealthRating` (whose `order by` must
  stay in lockstep with `latestDeliveryNoteFirst` below). **Filtering** on health or the flags is
  still unbuilt.
- ~~**`assembleRows` runs once per section**, so the grouped view fires this new query **five**
  times per render.~~ — **superseded by ADR 0061 §2**: the sections became tabs, so it runs
  **once** per render, over one page — *except* under `sort=margin`, which assembles the whole
  bucket. That is the multiplier anything added there now inherits.
- **The detail page gains a fourth tab and a fifth read.** `getProjectDeliveryNotes(id)` is a
  **sibling** read in the page's `Promise.all`, deliberately *not* folded into
  `ProjectDetailPlan`: `generateMetadata` calls the plan read too (so anything inside it is
  fetched twice per request just to title the tab), and that type is shared with the opportunity
  drawer's planner, which has no notes to show. `PlanSummaryTiles` therefore takes `health` as an
  **optional** prop.
- **The card renders health as text, not stars.** The whole card is wrapped in a `<Link>`, and
  `StarRating`'s interactive mode is a fieldset of buttons that must not nest inside one — while
  its read-only mode would put ten icons on every card in the grid. Stars live on the detail
  panel, where there is no wrapping link and one rating per row.
- **`resolveAuthorStaffId` moved** to `src/actions/shared/` (two CRM importers updated). ADRs
  [0030](./0030-crm-timestamped-entries-notes-next-steps.md) and
  [0043](./0043-tasks-entity-replaces-crm-next-steps.md) still describe its behaviour correctly;
  only the path changed.
- **`project-health.test.ts` and the extended `project-flags.test.ts`** are further sanctioned
  exceptions to [ADR 0037](./0037-unit-tests-removed-except-rbac-matrix.md), on ADR 0057's
  grounds: an inclusive threshold, the unrated silence and the label/bounds agreement are exactly
  what the type system can't express.
- **The seed forces four fixtures** (`seedProjectDeliveryNotes`, ~27 notes over the 15 projects): a
  project with **no** notes, one **at** the threshold, one **one above** it, and one with **two
  notes on the same `noteDate`** (worst then best) to exercise the `createdAt` tie-break. Their
  `createdAt`s are set **explicitly**, because `now()` is transaction-scoped in Postgres and a
  bulk insert would otherwise give every row the same instant, leaving that tie-break undefined.
  Thresholds are imported, not hardcoded, so moving the policy moves the fixtures.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| A `projects.health` column (edited inline, like a status) | A hand-maintained duplicate of the newest note that drifts silently on any edit or delete, and it throws away the *why* — the narrative is the point of the record (§1) |
| A `pgEnum` for the scale | Stores strings, sorts as text, and needs `ALTER TYPE` to widen a numeric scale; a check constraint sourced from the scale module is a code review (§2) |
| The rating inside a jsonb answers blob | The one closed-value field, the one thing aggregated, and the one a list row must badge — ADR 0042/0058's conclusion, again (§2) |
| A five-point scale, reusing `relationshipStrength` | Collapses the interesting middle; delivery leads already speak in tens (§2) |
| Author-only edit/delete, mirroring ADR 0058 | A shared operational record with a wrong rating and nobody able to fix it. Authorship is the point of a self-evaluation, not of a delivery note (§3) |
| A new `projects.deliveryNotes` capability | A second way to spell `projects.edit`; the two audiences are identical, and a matrix row would need the ADR 0014 lockstep for nothing (§5) |
| Gate the health *reads* (or the flag) like margin | Health is a human delivery judgement, not compensation-derived — the only reason margin is withheld (§4) |
| A draft/shared lifecycle, as `performance_review_note` has | A note is written to be seen by whoever can see the project; the form says so. The named retrofit is that table's `status`/`sharedAt` pair |
| Reduce every note in JS and take the newest | ~100 rows per project × every live project in an unpaginated section; `distinct on` returns one row per id and keeps `assembleRows`' fixed-query-count contract (§4) |
| Expire stale health automatically | Needs a policy answer, not code — recorded as an open question instead of guessed (Consequences) |
