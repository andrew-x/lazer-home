# Staff profile drawer in comp plans · Peer feedback + Review notes profile tabs

## Context

Running a compensation plan is a review conversation, but the plan editor only shows
money and a level. To judge a proposal a manager has to leave the editor and open
`/staff/[id]` in another tab, losing the plan's row context — and once there, two things
they need aren't on the profile at all: **the peer feedback that person has received**,
and **any record of past review conversations**.

Three connected changes:

1. **Click a name in a compensation plan → a read-only staff profile drawer** for
   in-context review, with a link out to the full profile.
2. **A "Peer feedback" tab on the staff profile** — feedback received about this person,
   with a link to `/feedback` for more.
3. **A "Review notes" tab** — a new entity: dated notes documenting performance-review
   conversations. A manager drafts a note (only they see it) and **shares** it (the
   person sees it too).

Outcome: a manager can review a person end-to-end without leaving the plan, and review
conversations get a durable, deliberately-shared home.

---

## Decisions taken (from the design conversation)

| Question | Chosen |
|---|---|
| Who may read a review note | **Relationship-based** — author, subject (shared only), subject's current `staff.managerId`, admin |
| Note shape | **Many dated notes**, each `DRAFT → SHARED` |
| Drawer content | **Read-only** profile review pane + "Open full profile" link |
| Notes editing in the drawer | **Yes** — same panel component as the profile page |

### ⚠️ This breaks a documented invariant — it needs its own ADR

[ADR 0047](../decisions/0047-feedback-reports-scoping-not-granting.md) states the rule
plainly: *"the reporting line scopes, it never grants"* — no permission check in this
codebase reads `staff.managerId`, and *"if a future change makes the reporting line
decide whether someone may read something, that's a different decision and needs its own
ADR."* Review notes do exactly that. Consequences to state out loud in the new ADR:

- **`staff.managerId` becomes an authorization input.** It is **CSV-import-populated with
  no in-app editor** and no cycle detection beyond a non-blocking `self` warning
  ([ADR 0026](../decisions/0026-staff-manager-self-reference.md)). A bad import now
  grants read **and write** access to performance-review notes, not just a wrong profile
  line.
- **It is not effective-dated.** Access follows the *current* reporting line: a manager
  who changes teams loses access to notes about their former reports (except ones they
  authored — the author path).
- **Self-guard, per ADR 0047 §4:** the manager path asserts `subject.id ≠ callerStaffId`,
  so a self-pointing `managerId` row can't make someone their own note-manager.
- **No new capability, so no matrix change.** `permissions.ts`,
  `permissions.test.ts` and the matrix table in `docs/domains/permissions.md` are
  untouched; permissions.md gains a **new prose section** describing the first
  relationship-based gate. (Being someone's manager is now sufficient — an IC with role
  `user` who manages someone can write notes about them. That is the accepted
  consequence of the chosen model.)

### The peer-feedback tab is also an exposure decision

A per-person feedback list on **any** profile is the "browse-all" surface ADR 0023/0047
deliberately deferred, in per-person form. It stays inside the **existing
`feedback.review` capability** (every row is one the holder can already open at
`/feedback/[id]`), so no matrix change — but it does widen *discovery* from
"my direct reports" to "anyone, one person at a time". Two guards:

- **Self branch wins first.** On your own profile you get the **limited recipient
  projection** (giver name + `messageToRecipient` + date) even if you hold
  `feedback.review` — a small tightening of ADR 0023's accepted reviewer-self-view gap,
  which stays open only via `/feedback/[id]`.
- **`null` hides the tab entirely** for a viewer who is neither the subject nor a
  reviewer, so the tab's presence never signals that feedback exists.

---

## 1. Schema — one new table

`src/lib/db/performance-schema.ts` (follow the `compensationPlan` block, lines ~160-252,
for conventions):

```ts
export const performanceReviewNoteStatusEnum = pgEnum(
  "performance_review_note_status",
  PERFORMANCE_REVIEW_NOTE_STATUSES,   // spread the pure tuple — ADR 0016
);

export const performanceReviewNote = pgTable(
  "performance_review_note",
  {
    id: text().primaryKey(),
    staffId: text().notNull().references(() => staff.id, { onDelete: "cascade" }),
    // Audit AND an authorization input (the author path). `set null` fails *closed*:
    // losing the author row narrows access to manager/admin, never widens it.
    authorUserId: text().references(() => user.id, { onDelete: "set null" }),
    noteDate: date({ mode: "string" }).notNull(),   // the conversation's date
    title: text(),
    body: text().notNull(),
    status: performanceReviewNoteStatusEnum().notNull().default("DRAFT"),
    sharedAt: timestamp(),                          // null while draft
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [index("performance_review_note_staff_idx").on(t.staffId)],
);

export type PerformanceReviewNote = InferSelectModel<typeof performanceReviewNote>;
```

Not effective-dated — a note is a document, not a fact about a person (same reasoning as
`compensation_plan`). Then `bun run db:generate` → `bun run db:migrate` (one migration:
enum + table, no backfill).

**Pure module** `src/lib/performance/review-note.ts` (client-importable, no drizzle):
`PERFORMANCE_REVIEW_NOTE_STATUSES = ["DRAFT", "SHARED"] as const`, the status type,
`REVIEW_NOTE_STATUS_LABELS`, and the share-confirmation copy so the dialog and any future
surface share one string.

## 2. Authorization — the new decision point

`src/actions/performance/reviewNoteAccess.ts`, modelled exactly on
`src/actions/staff/canEditStaff.ts` (predicate + `ActionAuthorize` hook pair):

```ts
export type ReviewNoteAccess = {
  isSubject: boolean;   // sees SHARED notes only, cannot manage
  canManage: boolean;   // draft / edit / share / delete  ⇒ also reads drafts
};

export async function getReviewNoteAccess(user, staffId): Promise<ReviewNoteAccess>
export const authorizeReviewNoteCreate: ActionAuthorize   // reads clientInput.staffId
export const authorizeReviewNoteMutate: ActionAuthorize   // reads clientInput.noteId → resolves staffId + author
```

- `callerStaffId` via the existing `src/actions/staff/ownStaffId.ts`.
- `isSubject = callerStaffId === staffId`.
- `canManage = isAdmin(user) || (subject.managerId === callerStaffId && callerStaffId !== staffId)`.
- **Per-note override:** an existing note is also manageable by its author
  (`note.authorUserId === user.id`), so an ex-manager can still fix or delete what they
  wrote. `authorizeReviewNoteMutate` resolves the note first, then applies
  `canManage || isAuthor`; a missing/non-string `noteId` **denies**.
- Use `isAdmin` / `userHasPermission` from `src/lib/auth/permissions.ts` — never an inline
  `user.role === …`.

## 3. Server layer

**Reads** (`import "server-only"` plain async functions):

- `src/actions/performance/getStaffReviewNotes.ts` →
  `{ canCreate: boolean; notes: ReviewNoteRow[] } | null`.
  `canManage` → all notes; `isSubject` → `status = 'SHARED'` only; otherwise
  author-only rows, and **`null` when that comes back empty** (hide the tab). Row carries
  `id, noteDate, title, body, status, sharedAt, createdAt, updatedAt, authorName`
  (join `user` for the name, as `getCompensationPlan` does for `createdByName`) plus a
  per-row `canManage` flag for the UI affordances.
  Keep `null` vs `[]` distinct — the ADR 0047 convention.
- `src/actions/feedback/getFeedbackAboutStaff.ts` →
  `{ tier: "recipient"; rows: FeedbackAboutMeRow[] } | { tier: "full"; rows: FeedbackAboutReportsRow[] } | null`.
  Self → delegate to the existing `getFeedbackAboutMe`; else `feedback.review` → the full
  projection **reusing `FeedbackAboutReportsRow`** (same shape the shared
  `FeedbackDetailDialog` already renders); else `null`.

**Mutations** (`src/actions/performance/`, one per file, `secureActionClient`, gate in
metadata only — never in the body):

| Action | Input | Gate |
|---|---|---|
| `createReviewNote` (+ `.schema.ts`) | `{ staffId, noteDate, title?, body }` | `authorize: authorizeReviewNoteCreate` |
| `updateReviewNote` (+ `.schema.ts`) | `{ noteId, noteDate?, title?, body? }` | `authorize: authorizeReviewNoteMutate` |
| `shareReviewNote` | `{ noteId }` | `authorize: authorizeReviewNoteMutate` |
| `deleteReviewNote` | `{ noteId }` | `authorize: authorizeReviewNoteMutate` |

- `createReviewNote` mints `generateId("prn")`, sets `authorUserId = ctx.user.id`, status
  `DRAFT`.
- `shareReviewNote` re-reads status and **refuses an already-shared note** (idempotency
  guard, like `committedAt` on plans). **Sharing is one-way** — no `unshare`: the person
  has already read it, so retraction is theatre. Deletion (author/manager/admin) is the
  escape hatch for a mistake.
- Editing is allowed in **both** states; the panel shows an "edited" marker when
  `updatedAt > createdAt` (the `EntryLog` convention).
- Revalidate through the existing `revalidateStaffProfile(staffId)` in
  `src/actions/staff/staffProfileMutation.ts` (covers `/profile` + `/staff/[id]`).
- Schemas imported by the client panel must be **hand-written zod, drizzle-free**
  (`.claude/rules/server-actions.md`), reusing `@/lib/schemas/id-schema` +
  `text-schema`.

**Drawer loader** — `src/actions/staff/loadStaffProfileDrawer.ts`, a `"use server"` +
`secureActionClient` read (the interactive-read exception, exactly like
`src/actions/crm/loadOpportunityDetail.ts`). Input `{ staffId }`; **no capability gate** —
viewing a profile is open to any signed-in active staff member, matching
`/staff/[id]`; every sensitive slice inside is gated by its own read.

Returns an **explicitly projected** payload: identity + employment *facets*
(role / line of business / employment type / billable / location / join date /
manager name), skills, client intro, `projects`, `feedback`, `reviewNotes`.
**CHANGED AFTER APPROVAL — the drawer now shows compensation, PTO and history, each
behind its own gate (`canViewCompensation` / `getStaffPto`'s `pto.review` / the comp
flag folded into `getStaffHistory`), and no longer shows email. The reasoning below
still holds; the response was to *gate* each field rather than omit it. See
`docs/domains/permissions.md` → the `loadStaffProfileDrawer` worked example.**

~~Deliberately no compensation and no PTO.~~ `getStaffProfile` returns comp amounts
inline on `profile.employment`, and the current pages only get away with that because
they render server-side — a client-fetched drawer would ship them in the response. The
plan row already shows the money it needs.

## 4. UI

**`plan-row.tsx:136`** — the plain `<span className="font-medium">{item.name}</span>`
becomes a `<button type="button">` (link-styled: `underline-offset-4 hover:underline
hover:text-primary`, `w-fit text-left`) calling a new `onOpenProfile(item.staffId)` prop.
`staffId` is already on `CompensationPlanEditorItem` and unused today. **Do not let it
double as the expand toggle** — the chevron stays the only expand affordance, and
expansion state is keyed on `itemId`.

**`plan-editor.tsx`** — one `useState<string | null>(null)` for the open staff id, thread
the handler through `<PlanRow>`, render `<StaffProfileDrawer>` once at the root. Don't
touch the autosave queue or the expanded `Set`; opening the drawer unmounts no rows, so no
`flushRow` is needed.

**`src/components/staff/staff-profile-drawer.tsx`** (new, client) — follows
`src/components/crm/opportunity-detail/sheet.tsx`: `<Sheet open onOpenChange>` +
`<SheetContent className="w-full gap-0 data-[side=right]:sm:max-w-[56rem]">`, load on
open via `useAction(loadStaffProfileDrawer)`, `Skeleton` while pending, and a `refresh()`
re-fetch passed to the notes panel's `onChanged`. Header: name, meta line, and an
**"Open full profile"** `Button render={<Link href={`/staff/${staffId}`} />}`
(`IconExternalLink`). Three `Tabs`: **Overview** (read-only — meta grid, `SkillsSection`,
client intro, `StaffProjectsSection`; these are directive-less presentational components
with type-only imports, so they render fine inside the client sheet), **Peer feedback**,
**Review notes**.

**`src/components/feedback/staff-feedback-panel.tsx`** (new, client) — takes the
`StaffFeedbackView`. `tier: "recipient"` reuses the existing `FeedbackAboutMe` list plus
its "only the message to you is visible" note; `tier: "full"` renders a compact table
(Author · Rating · Context · Date) opening the **shared `FeedbackDetailDialog`**, with the
reports-tab's honest line ("you can see each item in full — they can't"). Both tiers get a
**"View in Peer Feedback ↗"** link to `/feedback`.

**`src/components/performance/review-notes-panel.tsx`** (new, client) — newest-first list:
date, title, author, a `Draft`/`Shared` badge, `whitespace-pre-wrap` body, "edited"
marker. For a manager: "+ New note" composer (`DatePicker` + title `Input` + `Textarea`,
`useHookFormAction` per `.claude/rules/forms.md`, `loading` from `isExecuting`), per-note
**Edit**, **Share** (behind the shared `ConfirmDialog` — "they will be able to read
this"), **Delete** (`ConfirmDialog`). For the subject: read-only, with a line explaining
these are notes their manager shared. Discrete actions → `toast.success` (**not** the
autosave queue and **never** a `SaveIndicator` — this is a deliberate draft→share flow).
Optional `onChanged?: () => void` for the drawer (the `EntryLog` pattern).

**`src/components/staff/profile-view.tsx`** — two new props (`feedback`, `reviewNotes`) and
two new tabs rendered **only when their read is non-`null`**, placed before `history`:
`peer-feedback` and `review-notes`. Both `/staff/[id]/page.tsx` and `/profile/page.tsx`
add the two reads to their `Promise.all`. Note `/profile/page.tsx` hard-codes
`canEdit`/`canViewCompensation` — it must **not** do that for notes: a person is not their
own note-manager, so the reads decide. The profile tab set becomes viewer-dependent (the
same convention `/feedback` already has).

**Also fix while in there:** `profile-view.tsx:375-380` renders `EditResumeDialog`
unconditionally, unlike every other section — add the `canEdit ?` guard. Not a hole (the
write is gated by `authorizeStaffEdit`) but it shows a button that always fails.

## 5. Seed

`scripts/seed/performance.ts` gains **`seedReviewNotes`** (import the real table + the real
status tuple so `bun run check` catches drift): for ~60% of staff who have a `managerId`,
1–3 notes authored by that manager's user, all but the most recent `SHARED`, with a
`DRAFT` latest on about a third — so both statuses and both viewer perspectives have data.
Wire it into `scripts/seed.ts` (after `seedStaff`; no dependency on ratings) and add
`performance_review_note` to `SEEDABLE_TABLES` in `scripts/seed/wipe.ts`.

## 6. Docs — dispatch the `librarian` after implementation

Two new ADRs plus updates:

- **ADR — "Performance review notes: the reporting line becomes an authorization
  boundary"**: the invariant change, the CSV-import risk, the author path, the self-guard,
  one-way sharing, and why there's no new capability. Must add **correction notes** to
  ADR 0023 and ADR 0047, whose "no permission check reads the reporting graph" claim this
  supersedes.
- **ADR — "Peer feedback on the staff profile: per-person browse for reviewers, recipient
  tier for self"**: the discovery widening, and self-branch-first as a tightening of
  ADR 0023's deferred gap.
- Update `docs/domains/performance.md`, `docs/domains/staff-profiles.md`,
  `docs/domains/permissions.md` (new prose section — **matrix and test unchanged**),
  `docs/data-model.md`, `docs/ui.md` (the drawer + the viewer-dependent profile tab set).
- **Pre-existing bug to fix in passing:** two ADRs both claim number 0047
  (`0047-feedback-reports-scoping-not-granting.md` and
  `0047-plan-editor-status-ladder-display-units-and-level-targets.md`). Renumber one.

---

## Files

**New:** `src/lib/performance/review-note.ts` · `src/actions/performance/reviewNoteAccess.ts`,
`getStaffReviewNotes.ts`, `createReviewNote.ts(+.schema)`, `updateReviewNote.ts(+.schema)`,
`shareReviewNote.ts`, `deleteReviewNote.ts` · `src/actions/feedback/getFeedbackAboutStaff.ts` ·
`src/actions/staff/loadStaffProfileDrawer.ts` · `src/components/staff/staff-profile-drawer.tsx` ·
`src/components/feedback/staff-feedback-panel.tsx` ·
`src/components/performance/review-notes-panel.tsx` · one `drizzle/` migration · 2 ADRs.

**Modified:** `src/lib/db/performance-schema.ts` ·
`src/components/performance/compensation-plans/plan-row.tsx`, `plan-editor.tsx` ·
`src/components/staff/profile-view.tsx` · `src/app/(app)/staff/[id]/page.tsx` ·
`src/app/(app)/profile/page.tsx` · `scripts/seed/performance.ts`, `scripts/seed.ts`,
`scripts/seed/wipe.ts` · the docs above.

**Untouched on purpose:** `src/lib/auth/permissions.ts` and
`src/lib/auth/permissions.test.ts` — no new capability, no matrix change.

## Verification

1. `bun run db:generate && bun run db:migrate`, then `bun run db:seed`.
2. `bun run check` (Biome + `tsc --noEmit` + the RBAC matrix test) and `bun run build`.
3. `bun run dev`, then walk it as **three** identities (roles/`managerId` are settable via
   `/admin/manage-users` and the DB):
   - **A manager, on their own report:** `/performance/compensation-plans/[planId]` → click
     a name → drawer opens read-only with Overview / Peer feedback (full content) / Review
     notes. Draft a note → confirm it does **not** appear for the subject → Share → it
     does. "Open full profile" lands on `/staff/[id]` with the same two tabs.
   - **The subject, on `/profile`:** Review notes shows **only** shared notes, no compose
     or share controls; Peer feedback shows the **limited recipient projection** (message +
     giver name only — no rating/context/keep-stop-start).
   - **A manager who is *not* this person's manager:** Peer feedback tab present (they hold
     `feedback.review`), Review notes tab **absent**, and calling `createReviewNote` /
     `shareReviewNote` for that person is rejected by the `authorize` hook.
4. ~~Confirm the drawer's network response carries **no compensation and no PTO**~~
   **SUPERSEDED** — the drawer was later asked to *show* current compensation, PTO and
   the history feed (and to drop email). Instead confirm each arrives **gated**: the
   `loadStaffProfileDrawer` payload carries `compensation: null` for a viewer without
   `staff.viewCompensation`, `pto: null` for one without `pto.review`, and `history`
   entries whose summaries omit money when the comp gate failed.
5. Confirm the plan editor still behaves: expand/collapse unaffected, autosave still saves,
   a committed plan's drawer still opens (read-only).
6. Run **`/audit-rbac`** (this change adds a new authorization mechanism — it must be
   clean) and **`/code-review`** before shipping.
