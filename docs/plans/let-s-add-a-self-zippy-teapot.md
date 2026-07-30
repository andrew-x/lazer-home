# Staff self-evaluations

## Context

Performance management today captures **other people's** views of a person: peer
feedback (`feedback`), manager review notes (`performanceReviewNote`), and
manager-assigned rating levels (`staffRating`). The person's own view is missing —
so a compensation-plan reviewer sits down to assess someone with no first-person
account of the last six months in front of them.

This adds **self-evaluations**: a periodic questionnaire a staff member fills out
about themselves, readable by the person and by managers. It surfaces in two
places — a tab on the staff profile (where it gets written) and a tab in the
compensation-plan review drawer (where it gets read).

Answers are stored as **JSON question/answer pairs with the section and prompt
snapshotted alongside each answer**, so when the question set is reworded or
questions retire, old records still render exactly as they were answered. That
requirement is the design's centre of gravity.

### Decisions taken (confirmed with the user)

| | |
|---|---|
| **Read gate** | Own record always; anyone else needs `ratings.view` (manager + admin today) — the same gate as the Evaluations tab. **No new capability**, so the permission matrix, `permissions.test.ts`, and the matrix table in `docs/domains/permissions.md` are all untouched. |
| **Lifecycle** | None. A record exists once saved and is immediately visible to `ratings.view` holders. |
| **Saving** | One form, explicit Save (react-hook-form + next-safe-action). Not the autosave queue. |
| **Periodicity** | Free-form dated records; the tab lists them newest-first, like the review-notes panel. |
| **Writes** | Author-only. A `ratings.view` holder can read but never create, edit, or delete someone else's — the document's value is that it's the person's own words. |

Two consequences worth stating out loud rather than discovering later, both
following directly from the decisions above:

- **No draft state means the first Save publishes.** A half-finished self-critical
  document becomes visible to every `ratings.view` holder, and Delete is the only
  remedy. Mitigation: the Save button carries a `SELF_EVALUATION_SAVE_WARNING`
  saying so (the `REVIEW_NOTE_SHARE_WARNING` precedent). If this proves wrong,
  `performanceReviewNote`'s `status`/`sharedAt` pair is the retrofit — one nullable
  column and one `where` clause, not a rewrite.
- **`ratings.view` is wider than the reporting line.** Any manager can read any
  person's self-evaluation, while that manager's own notes about the same
  conversation are reporting-line-gated and *narrower*. The person's words end up
  more widely readable than their manager's notes about them. That is what the
  chosen gate means (and it matches the Evaluations tab); it belongs in
  `permissions.md` as prose.

### The ADR 0032 guardrail — must not be broken

`ratings.view` guards `staffRating.level` (L0–L4, manager-assigned) which a
staffer **never** sees about themselves. This feature reuses that capability for
data that has a full owner path. They coexist only because they guard different
things. Put this comment in the schema, the read, and the record component:

> The self-rating is the person's **own** five-point self-assessment. It is **not**
> `staffRating.level` — a different scale, assigned by someone else.
> `getStaffSelfEvaluations` must never join `staffRating` or project a level, and
> the Self-evaluations tab must never render one beside the self-rating.

The plausible future breach is someone adding the assigned level next to the
self-rating "for comparison". That would silently end ADR 0032.

---

## Why a new table (not `responses`)

`responses` is `unique(staffId, questionId)` with `onConflictDoUpdate` — one
*current* value per question (ADR 0028). A periodic record needs N rows per
(person, **occasion**), and the occasion can't be encoded in `questionId` because
valid ids are a fixed TS tuple. ADR 0028's "an orphaned id simply stops being
read" is fine for a profile survey and is **data loss** for a dated snapshot.

---

## Phase 0 — pure module + table

### 1. `src/lib/performance/self-evaluation.ts` — new

Pure, client-importable (no `db`/drizzle), in `performance/` beside
`review-note.ts` — this is assessment machinery gated by `ratings.view`, unlike
Manual of Me / Ways of Working which are profile self-*description* and live in
`staff/`.

```ts
export const SELF_EVALUATION_QUESTION_SET_VERSION = 1;

// Canonical display order. STABLE ids stored in the jsonb: renaming one is a data
// migration; prompts, sections and guidance change freely. NEVER reuse a retired
// id for a different question.
export const SELF_EVALUATION_QUESTION_IDS = [
  "SE_OUTPUT", "SE_COMMUNICATION", "SE_PRODUCT_MANAGEMENT", "SE_AI_COMPETENCY",
  "SE_LAZER_CULTURE", "SE_PERSONAL_DEVELOPMENT", "SE_GROWTH",
] as const;
export type SelfEvaluationQuestionId = (typeof SELF_EVALUATION_QUESTION_IDS)[number];

export type SelfEvaluationQuestion = {
  section: string;              // "Output" — snapshotted
  prompt: string;               // the question sentence — snapshotted
  guidance: readonly string[];  // the sub-bullets — NOT snapshotted
};

// A Record, not Manual of Me's bare array: tsc then enforces one entry per id, so
// adding an id can't ship a question with no text (no unit test needed, ADR 0037).
export const SELF_EVALUATION_QUESTIONS:
  Record<SelfEvaluationQuestionId, SelfEvaluationQuestion> = { … };
```

The stored shape, and the one type decision that carries the feature:

```ts
export type SelfEvaluationAnswer = {
  /** DELIBERATELY `string`, not the union: a stored record may hold an id retired
   *  from the tuple. Typing it as the union makes old rows unrepresentable and
   *  pushes readers toward a cast. Writes validate against the current enum;
   *  reads accept any string. Two schemas over one shape. */
  questionId: string;
  section: string;   // as presented when answered
  prompt: string;    // as presented when answered
  answer: string;    // always non-empty — blanks are dropped at write time
};

/** Current-question-set answers → the stored snapshot. Blank answers are OMITTED,
 *  so `entries.length` is the answered count and no record stores rows that later
 *  render as empty blocks. Shared by create, update AND the seed — which makes the
 *  seed a real drift guard. */
export function buildSelfEvaluationEntries(
  answers: Record<SelfEvaluationQuestionId, string | null>,
): SelfEvaluationAnswer[];
```

Question content, verbatim from the user's brief: prompt = the leading sentence,
`guidance` = the sub-bullets. `SE_PERSONAL_DEVELOPMENT` has no leading sentence in
the brief — use "How have you grown since the last time we talked?" as its prompt
and the remaining bullets as guidance.

Also exported: `SELF_RATING_PROMPT`, `SELF_RATING_DESCRIPTIONS:
Record<FeedbackRating, string>` (the user's five first-person sentences — the
values and labels come from `feedback-rating.ts`, only the descriptions are new
here, since the existing `FEEDBACK_RATING_DESCRIPTIONS` are third-person),
`SELF_EVALUATION_ANSWER_MAX = 10_000`, `SELF_EVALUATION_SNAPSHOT_TEXT_MAX = 500`,
`SELF_EVALUATION_SAVE_WARNING`.

**Reuse `FEEDBACK_RATINGS` / `FEEDBACK_RATING_LABELS` from
`src/lib/performance/feedback-rating.ts`** — verified: its five values and labels
are exactly Above and beyond / Top performer / Solid contributor / Minor misses /
Needs improvement. One TS source (ADR 0016), no duplicate tuple.

### 2. `src/lib/db/performance-schema.ts` — modify

Append after `performanceReviewNote`:

```ts
// Values spread from the shared tuple in @/lib/performance/feedback-rating (ADR
// 0016) — the scale IS peer feedback's five words. A SEPARATE pg type, not a reuse
// of `feedback_rating`, so peer-feedback churn never forces an ALTER TYPE on a
// type two tables depend on.
export const selfEvaluationRatingEnum = pgEnum("self_evaluation_rating", [...FEEDBACK_RATINGS]);

export const staffSelfEvaluation = pgTable("staff_self_evaluation", {
  id: text().primaryKey(),                                    // generateId("sev")
  // Subject AND author — only the subject may write one, so a separate author
  // column would be a redundant copy. An "on behalf of" path would be a migration;
  // deliberately not pre-built.
  staffId: text().notNull().references(() => staff.id, { onDelete: "cascade" }),
  evaluationDate: date().notNull(),                           // string mode
  questionSetVersion: integer().notNull(),                    // a column, so "how many rows are still v1" is a query
  selfRating: selfEvaluationRatingEnum().notNull(),
  answers: jsonb().$type<SelfEvaluationAnswer[]>().notNull(), // `[]` is legal
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index("staff_self_evaluation_staff_idx").on(t.staffId)]);

export type StaffSelfEvaluation = InferSelectModel<typeof staffSelfEvaluation>;
```

- **No unique index on `(staffId, evaluationDate)`** — free-form dated records were
  the decision; two on one date is legal and `desc(evaluationDate),
  desc(createdAt)` still orders stably.
- **No CHECK** — the pgEnum constrains the only closed-value field; jsonb *shape*
  is validated at the zod layer (ADRs 0028, 0042).
- `src/lib/db/schema.ts` needs no change (`export * from "./performance-schema"`).

Then `bun run db:generate` → `bun run db:migrate`. Creating a new enum type is an
ordinary migration (only `ALTER TYPE … ADD VALUE` has the transaction gotcha).

### What gets snapshotted, and what doesn't

| | Snapshotted? | Why |
|---|---|---|
| `questionId` | **yes** | the only join key a future migration can key on |
| section title | **yes** | one short string; it's how the answer is grouped and read |
| prompt text | **yes** | **the prompt is the question the sentence answers.** Reword it and rendering the new prompt above an old answer misrepresents what the person said |
| sub-bullet guidance | no | coaching scaffolding for the *writer*, not part of the question's meaning; needed only while filling in the form |
| rating labels / descriptions | no | the rating is a pgEnum *value* — identity is durable in the DB, label looked up at render. Labels changing everywhere is correct for an enum |
| the rating prompt | no | acceptable because the value set is closed: meaning rides the value, not the wording |

**A record whose `questionId` no longer exists renders with no special handling —
that is the whole point.** The record component iterates `row.answers` in stored
order and prints `section`/`prompt`/`answer` **off the row**, never indexing into
`SELF_EVALUATION_QUESTIONS`. A retired question still shows its original prompt; a
reworded one shows the original wording; a newly added one simply doesn't appear on
old records. The reviewable invariant:

> `self-evaluation-record.tsx` must not import `SELF_EVALUATION_QUESTIONS`.

The current question set is consulted by exactly two things: the **form** (which
questions to present) and the **write** (deriving the snapshot).

### Why the self-rating is its own column, not a jsonb entry

1. **The list badge** needs the rating without parsing jsonb — the read projects a
   scalar and the badge is `FEEDBACK_RATING_LABELS[row.selfRating]`. In jsonb it
   would be `answers.find(e => e.questionId === "SE_RATING")?.answer` in every
   consumer: a magic id, an unconstrained string, no type safety.
2. **It's the only answer with a closed value set**, so the DB *can* constrain it
   where it can't constrain prose — exactly the `staffRating.level` (typed) vs
   `staffRating.subratings` (jsonb + zod) split of ADR 0042.
3. **It's the only field anything will aggregate or filter on** (self-rating
   distribution; "who rated themselves Needs improvement").
4. **It keeps `answers` homogeneous** — one type, no discriminated union.

`notNull` is deliberate: since every free-text answer may be blank, a required
rating guarantees no record is fully empty and every list row renders a badge.

---

## Phase 1 — server layer

### 3. `src/actions/performance/selfEvaluations.schema.ts` — new

One family module for all three actions (the `reviewNotes.schema.ts` precedent),
**hand-written and drizzle-free** because the client form imports it (ADR 0035).

The load-bearing call: **the client submits raw answers, never the snapshot.**

```ts
// Generated FROM the tuple, so adding a question can't be forgotten here.
const answerFields = Object.fromEntries(
  SELF_EVALUATION_QUESTION_IDS.map((qid) => [
    qid, optionalTrimmedText(SELF_EVALUATION_ANSWER_MAX),   // "" → null
  ]),
) as Record<SelfEvaluationQuestionId, ReturnType<typeof optionalTrimmedText>>;

export const selfEvaluationFields = {
  evaluationDate: dateString,
  selfRating: z.enum(FEEDBACK_RATINGS),
  answers: z.object(answerFields),
};
export const selfEvaluationContentSchema = z.object(selfEvaluationFields); // form resolver
export const createSelfEvaluationSchema = z.object(selfEvaluationFields);  // NOTE: no staffId
export const updateSelfEvaluationSchema = z.object({ evaluationId: id, ...selfEvaluationFields });
export const deleteSelfEvaluationSchema = z.object({ evaluationId: id });
// + the z.input / z.output types, per .claude/rules/server-actions.md
```

`section`/`prompt` are **derived server-side** via `buildSelfEvaluationEntries`,
never accepted from the client — accepting them would let a crafted payload store
a fabricated prompt above a real answer, an integrity hole in a document whose
value is being a faithful record of what was asked. Derive, don't verify.

Reuse `optionalTrimmedText` (`src/lib/schemas/text-schema.ts`), `dateString`
(`date-schema.ts`), `id` (`id-schema.ts`).

### 4. `src/actions/performance/selfEvaluationAccess.ts` — new (`server-only`)

The `reviewNoteAccess.ts` shape, deliberately much smaller:

```ts
/** Author-only. There is NO capability path and NO admin override: a self-
 *  evaluation is a first-person document, and an admin editing it would be putting
 *  words in someone's mouth. Contrast reviewNoteAccess, where admin IS a blanket
 *  override because a manager writing about someone else needs an escalation path.
 *  A retraction path for HR would be a separate, audited action — not a widening
 *  of this hook. */
export const authorizeSelfEvaluationMutate: ActionAuthorize = async ({ user, clientInput }) => {
  const evaluationId = (clientInput as { evaluationId?: unknown }).evaluationId;
  if (typeof evaluationId !== "string") deny();

  const [row] = await db.select({ staffId: staffSelfEvaluation.staffId })
    .from(staffSelfEvaluation).where(eq(staffSelfEvaluation.id, evaluationId)).limit(1);
  if (!row) deny();   // missing denies with the SAME message as forbidden — no id probing

  const callerStaffId = await ownStaffId(user.id);
  if (callerStaffId === null || callerStaffId !== row.staffId) deny();
};
```

**`activeOnly` decision** (`docs/domains/permissions.md` requires this to be
conscious): **plain `ownStaffId`, no `activeOnly`.** This is an *ownership* check —
the caller's identity is resolved only to compare against their own row, so a
stale-active caller reaches nothing but themselves. That's the
`canEditStaff`/`canViewCompensation` rule of thumb, not the
`reviewNoteAccess`/`canGiveFeedback` one (those use the caller's identity to reach
**other people's** data).

### 5. `src/actions/performance/getStaffSelfEvaluations.ts` — new (`server-only`)

**One read serves both surfaces.**

```ts
export type SelfEvaluationRow = {
  id: string; evaluationDate: string; questionSetVersion: number;
  selfRating: FeedbackRating; answers: SelfEvaluationAnswer[];
  createdAt: Date; updatedAt: Date;
  /** Whether THIS reader may edit it — author only, and only while the record's
   *  question set is still current (see the edit rule below). */
  canManage: boolean;
};
export type StaffSelfEvaluationsView = {
  canCreate: boolean;  // own record only
  isSelf: boolean;     // drives the panel's second-person copy
  evaluations: SelfEvaluationRow[];
};
export async function getStaffSelfEvaluations(
  staffId: string,
): Promise<StaffSelfEvaluationsView | null>
```

Gate resolution, in this order:

```ts
const user = await getCurrentUser(); if (!user) return null;
const callerStaffId = await ownStaffId(user.id);          // plain variant, per above
const isSelf = callerStaffId !== null && callerStaffId === staffId;
if (!isSelf && !userHasPermission(user, { ratings: ["view"] })) return null;
// … explicit column projection, orderBy desc(evaluationDate), desc(createdAt) …
return {
  canCreate: isSelf,
  isSelf,
  evaluations: rows.map((r) => ({
    ...r,
    canManage: isSelf && r.questionSetVersion === SELF_EVALUATION_QUESTION_SET_VERSION,
  })),
};
```

- **`isSelf` first**, mirroring `getFeedbackAboutStaff`'s branch order. Here it's
  the *widest* branch rather than a tightening, but it still must come first
  because it decides `canCreate`/`canManage` — a `ratings.view` holder on their own
  profile correctly gets write affordances.
- **`null` = no tab at all; `[]` = permitted, nothing yet** (the ADR 0047
  convention). Collapsing them either discloses the surface to everyone or hides it
  from an entitled manager with no data.
- The docblock carries the ADR 0032 note verbatim.
- **No drawer-specific variant** — unlike comp there is nothing to strip; the
  payload is text the viewer is entitled to in full.

### 6–8. The three write actions

| File | `metadata` | Notes |
|---|---|---|
| `createSelfEvaluation.ts` | `{ action: "create-self-evaluation" }` | **Needs the explicit justifying comment** the permissions rule demands: *the input carries no target id, so there is nothing to forge — `staffId` comes from `getCurrentStaffId()` in the body, and an `authorize` hook would have no `clientInput` field to read.* Body: `getCurrentStaffId()`; `null` → `UserSafeActionError("Your staff profile isn't set up yet.")`; `buildSelfEvaluationEntries`; insert with `generateId("sev")` + `SELF_EVALUATION_QUESTION_SET_VERSION`; `revalidateStaffProfile(staffId)`; return `{ id }`. |
| `updateSelfEvaluation.ts` | `{ action, authorize: authorizeSelfEvaluationMutate }` | Re-reads `questionSetVersion` **from the DB** and rejects when stale (the `requireDraftPlan` discipline — never trust the client for state). Rewrites `evaluationDate`, `selfRating`, `answers`; never touches `staffId` or `questionSetVersion`. Revalidates the profile. |
| `deleteSelfEvaluation.ts` | `{ action, authorize: authorizeSelfEvaluationMutate }` | With no draft state, delete is the only retraction path (the `deleteReviewNote` reasoning), and it's the author's own words. |

Reuse `revalidateStaffProfile` from `src/actions/staff/staffProfileMutation.ts`.

---

## Phase 2 — UI

### 9. `src/components/performance/self-evaluation-record.tsx` — new

Presentational: date · rating badge · "N of M prompts answered" · "edited" when
`updatedAt > createdAt` · a muted "answered against an earlier set of questions"
note when `questionSetVersion` is stale · then `answers.map()` rendering
section/prompt/answer **from the row**, `whitespace-pre-wrap`, **no clamping**
(a truncated self-assessment is a misleading one). Its own file precisely so the
"must not import the question set" invariant is reviewable in one place.

### 10. `src/components/performance/self-evaluation-form.tsx` — new, client

Seven sections (heading + prompt + guidance `<ul>` + `Textarea`), then the rating
`RadioGroup` last (it's the summary judgement) — copy the label-wrapping block
from `feedback-form.tsx` including its `biome-ignore` for
`noLabelWithoutControl`. A date field defaulting to today, the
`SELF_EVALUATION_SAVE_WARNING` above Save, and a **`sticky bottom-0`** Save/Cancel
bar since the form is tall.

**Loose binding** (`useForm` + `useAction`, forms rule (b)): the form shape ≠
either action's input (create takes no id, update adds one). Discriminated props so
"neither" can't be constructed, the `ReviewNoteForm` trick: `{ mode: "create";
evaluation?: never } | { evaluation: SelfEvaluationRow; mode?: never }`. RHF field
names are the `SE_` ids (no dots, so no path ambiguity). Errors via `FormField` +
`applyServerIssues`; server error off `result.serverError`.

### 11. `src/components/performance/self-evaluation-panel.tsx` — new, client

`review-notes-panel.tsx` transposed: intro line (second-person when `isSelf`), a
"Start a self-evaluation" button when `view.canCreate && !composing`, the inline
form, the newest-first list of `SelfEvaluationRecord`s with per-record Edit/Delete
when `record.canManage`, a confirm dialog for delete whose copy says *"Managers who
can see your self-evaluations will lose access to this one."*, and `afterChange()`
= `onChanged?.() ?? router.refresh()`.

Props: `{ staffName, view, onChanged?, readOnly? }` — **no `staffId`**, because the
create action doesn't take one. That absence is a useful tell that the write is
self-scoped.

**The form lives inline in the panel.** Not a dialog (eight questions with guidance
is far too tall for `FormDialog`). Not a dedicated route: those exist for the
autosaving step-railed guided surveys (Manual of Me, Ways of Working) and for
skills' two-panel catalogue — this is one explicit Save of one form, i.e. the
review-notes composer, and a route couldn't exist inside the drawer at all.
Promoting it to `/staff/[id]/self-evaluation/new` later is cheap because the form
is already a separate component.

### 12–15. Wiring the two tab surfaces

- **`src/components/staff/profile-view.tsx`** — new prop `selfEvaluations:
  StaffSelfEvaluationsView | null`; paired conditional `TabsTrigger` +
  `TabsContent` (`value="self-evaluations"`, label "Self-evaluations") rendered iff
  non-null, placed **after Review notes, before History** so the performance tabs
  cluster. Profile now tolerates 5–8 tabs.
- **`src/app/(app)/staff/[id]/page.tsx`** and **`src/app/(app)/profile/page.tsx`**
  — add `getStaffSelfEvaluations(id)` to the existing `Promise.all` and pass it
  through. **`/profile` must not hard-code it** the way it hard-codes
  `canEdit`/`canViewCompensation`: the read's answer is the right answer, exactly
  as for `feedback`/`reviewNotes`.
- **`src/actions/staff/loadStaffProfileDrawer.ts`** — add `selfEvaluations:
  StaffSelfEvaluationsView | null` to `StaffProfileDrawerData` (with the "null
  means not permitted, never 'none on file'" comment) and the read to the
  **existing `Promise.all`** — it depends on no other gate, so it does *not* join
  the sequential `getStaffHistory` tail.
- **`src/components/staff/staff-profile-drawer.tsx`** — conditional
  Self-evaluations tab, placed after Review notes and before Evaluations so the
  self-assessment sits next to the manager assessment. Drawer becomes 3–9 tabs.

**Editing in the drawer: no — pass `readOnly`.** A reviewer isn't the subject, so
the affordances would never show in the normal case. In the uncommon case (a
`ratings.view` holder opening their *own* drawer) `canCreate` would be true and the
drawer would sprout a seven-textarea form inside a `56rem` sheet layered over a
mid-edit plan editor. Say in the code that **`readOnly` is a host display
constraint, not permission logic** — the server gate is unchanged and unchangeable
from the client, and "Open full profile" is the affordance for actually writing.
Rejected alternative: having `loadStaffProfileDrawer` force `canCreate: false` —
that puts a presentation decision inside a gate and makes the drawer's payload
disagree with the profile's for the same viewer.

---

## Phase 3 — seed and docs

- **`scripts/seed/performance.ts`** — `seedSelfEvaluations(db, staff)` after
  `seedReviewNotes` (no ordering dependency): ~50–60% of **active** staff get 1–2
  records dated across the last ~18 months, weighted ratings, 1–7 answered prompts
  of faker prose, entries built by calling the real
  **`buildSelfEvaluationEntries`** so a question-set edit that breaks the shape
  surfaces as a `bun run check` failure.
- **`scripts/seed.ts`** — import, call, and add a `selfEvaluations` row to the
  `console.table`.
- **`scripts/seed/wipe.ts`** — add `"staff_self_evaluation"` to `SEEDABLE_TABLES`
  in the `// performance + survey` block (child→parent).
- **Docs: dispatch the `librarian` subagent** (don't hand-write) for
  `docs/domains/performance.md` (a new "Staff self-evaluations — built" section),
  `docs/domains/staff-profiles.md` (viewer-dependent tab count, drawer tab list),
  `docs/domains/permissions.md` (**prose only, no matrix change**: the
  reviewer/owner split, the wider-than-reporting-line asymmetry above, and a new
  row in the drawer gate table — a capability gate *with* a full owner path, read
  and write, which is a fourth gate shape for that table), plus a new ADR recording:
  new table not `responses`; snapshot prompt+section but not guidance or enum
  labels; rating as a typed column; author-only writes with `ratings.view` as the
  *read* gate; edit blocked across question-set versions; and explicitly that ADR
  0032 is not weakened.

---

## Edge cases

| Case | Decision |
|---|---|
| **No linked staff profile** | `/profile` already `notFound()`s. The read returns `null`. `createSelfEvaluation` throws `UserSafeActionError("Your staff profile isn't set up yet.")` — never a fabricated id, never a 500. |
| **Editing a record from an older question set** | **Blocked.** The form only shows current questions and the update replaces `answers` wholesale, so editing a v1 record under a v2 set would silently delete answers to retired questions and re-label the rest — data loss on an edit, the exact thing the snapshot prevents. So `canManage` is false for a stale record (read side) *and* `updateSelfEvaluation` re-reads the version from the DB and rejects (server side). Delete stays available. Never fires today (v1 only). Named upgrade path if it bites: edit the still-current questions and merge-preserve the orphaned entries. |
| **Two records on the same date** | Legal and deliberate — no unique index. Ordered by `desc(evaluationDate), desc(createdAt)`. Both show the same date; **do not** disambiguate with a time (`createdAt` is timezone-less wall-clock and rendering it invites the bug `.claude/rules/database.md` warns about). |
| **Empty answers** | Blank → `null` at the schema → entry omitted from the jsonb. All seven blank is legal; the record then shows just the rating. **No `.refine` requiring at least one** (unlike `createFeedback.schema.ts`): the rating is required and is itself a complete answer, and blocking a save mid-thought is the friction the no-draft decision was avoiding. Thin records are made *visible* ("N of 7 answered"), not impossible. |
| **Very long text** | 10 000 chars per answer (the `upsertResponse` survey precedent; review notes' 20 k is one field, here there are seven). Total ≈70 k + snapshot text — comfortably inside a jsonb value and the action body limit. Snapshot `section`/`prompt` capped at 500 each. No truncation on render. |
| **Retired then re-added id** | Old records keep old prompts. Hard rule in the module docblock: never reuse a retired `SE_` id for a different question. |
| **`ratings.view` holder on their own profile** | Gets `isSelf` → full write affordances and sees their own records. Correct, and **not** the ADR 0032 self-view gap: nothing manager-assigned is rendered. |
| **Inactive staff** | `/staff/[id]` renders inactive profiles; their self-evals are readable by capability holders, consistent with the rest of the profile. |
| **Staff row deleted** | Cascades, mirroring `staffRating` / `performanceReviewNote`. |

---

## Verification

1. `bun run db:generate` → `bun run db:migrate` → `bun run db:seed --yes`
2. `bun run check` (Biome + `tsc --noEmit` + `bun test`) — **no new test files.**
   `permissions.test.ts` is untouched because the matrix is untouched; ADR 0037
   rules out broad unit tests, and `Record<SelfEvaluationQuestionId, …>` makes tsc
   enforce the one invariant a test would have covered.
3. `bun run build`
4. Manual click-through, in this order:
   1. `/profile` with no records → empty state + "Start a self-evaluation". Save
      one → it appears with its badge and "N of 7 answered". Edit it. Delete it
      (confirm copy mentions manager visibility).
   2. `/staff/<someone-else>` as `manager` → tab present, **no** Start/Edit/Delete.
   3. Same page as a plain `user` → **no tab at all** (not an empty one).
   4. `/staff?view=org` → click a node → tab present for a manager, read-only.
   5. Compensation-plan editor → click a name → same, and confirm the editor
      underneath doesn't re-render.
   6. A manager opening **their own** drawer → tab present, **still read-only**;
      their `/profile` remains writable.
   7. **The acceptance test for the whole design:** locally bump
      `SELF_EVALUATION_QUESTION_SET_VERSION` to `2` and reword one prompt, then
      reload the profile. The existing record must still show the **old** prompt,
      must show the "earlier set of questions" note, and its **Edit button must be
      gone**. Revert after.
5. `/audit-rbac` (required by the permissions rule before claiming permission work
   done) and `/code-review`.
