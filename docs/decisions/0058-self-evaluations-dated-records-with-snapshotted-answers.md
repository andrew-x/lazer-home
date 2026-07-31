# 0058 — Staff self-evaluations: a dated table with snapshotted answers, author-only writes

**Status:** accepted · 2026-07-30 · **departs from**
[ADR 0028](./0028-generic-responses-table-app-validated-question-ids.md) for *periodic*
questionnaires (the generic `responses` table stays as-is for profile surveys) ·
mirrors [ADR 0042](./0042-per-role-subratings-app-owned-jsonb.md)'s typed-column ⁄ jsonb
split · reuses [ADR 0016](./0016-junction-table-and-shared-enum-conventions.md)'s
one-TS-tuple rule while declaring a **separate pg type** · sibling of
[ADR 0049](./0049-review-notes-reporting-line-as-authorization-boundary.md) (the same
"document, not a fact" shape, a deliberately *different* gate) ·
**does not weaken [ADR 0032](./0032-staff-rating-levels-effective-dated-manager-only.md)**

## Context

The performance domain already had three views of a person written by *other* people:
peer feedback (colleagues), review notes (their manager), and a `staff_rating` level
(assigned by a manager). It had nothing in the **first person**. The consultancy runs a
periodic reflection questionnaire — seven free-text prompts (Output, Communication,
Product Management, AI Competency, Lazer Culture, Personal Development, Growth) plus one
overall self-rating — and it needed a home.

Two existing shapes were candidates, and each is wrong in an instructive way:

- The generic **`responses`** table (ADR 0028) is `unique(staffId, questionId)` with an
  upsert write: it stores **one *current* answer per question per person**. That is right
  for Manual of Me / Ways of Working, where the profile survey *is* a current state.
- **`staff_rating`** (ADR 0032 / 0042) is effective-dated: rows supersede each other and
  the latest one is the truth.

A self-evaluation is neither. It is a **dated document** — N answers per (person,
**occasion**), where two occasions coexist forever and neither supersedes the other, the
same category as `performance_review_note` and `compensation_plan`.

The second problem is **time**. The question set will be reworded, questions will be
retired and added. A record written in 2026 must still read in 2029 as what the person
was actually asked. And the third is **who may read a first-person document about
performance** — where the obvious capability, `ratings.view`, is the one that ADR 0032
says must never expose a level to its own subject.

## Decision

### 1. A new table, `staff_self_evaluation` — not the generic `responses` table

`responses` cannot express "N rows per occasion" without dropping its unique constraint,
which is the constraint that makes it an upsert-able current-state store. And ADR 0028's
tolerance for drift — *"an orphaned question id simply stops being read"* — is fine for a
profile survey (nobody mourns a retired Manual-of-Me prompt) but is **silent data loss**
for a dated snapshot: it would quietly delete part of what a person said about
themselves in a specific review period.

Shape (`src/lib/db/performance-schema.ts`, `drizzle/0019_yummy_grandmaster.sql`):
`staffId` (FK → `staff`, cascade, indexed) · `evaluationDate` (`date`, the period
reflected on, chosen by the author) · `questionSetVersion` (`integer`) · `selfRating`
(pgEnum, notNull) · `answers` (jsonb) · timestamps. **Not effective-dated**, and **no
`unique(staffId, evaluationDate)`** — two records may share a date, ordered by
`desc(evaluationDate), desc(createdAt)`.

> **Amended, same day:** `evaluation_date` was **dropped again** by
> `drizzle/0020_wakeful_nightcrawler.sql`. A record is dated by **`createdAt`** — when it
> was submitted — and ordered by `desc(createdAt)` alone, so no tiebreaker and nothing to be
> unique against. Everything else in this ADR stands; read `performance-schema.ts` for the
> shipped shape. (The author-chosen-date pattern survives on
> `performance_review_note.noteDate` and `project_delivery_notes.noteDate`, where the note is
> written *about* a period — see
> [ADR 0059](./0059-project-delivery-notes-and-list-health.md).)

`staffId` is **subject *and* author**; a separate author column would be a redundant copy
of it (see §4). An "on behalf of" path would be a migration, deliberately not pre-built.

### 2. Answers are a snapshot — the record renders entirely from itself

Each stored entry is `{ questionId, section, prompt, answer }`: the section heading and
the prompt **as presented when the person answered**, stored alongside the text.
`self-evaluation-record.tsx` therefore **must not import `SELF_EVALUATION_QUESTIONS`**,
and says so in a header comment. Rendering today's wording above a two-year-old answer
would misattribute words to people — the exact failure this design exists to prevent.

Only **two** places may consult the current question set: the form (which prompts to
show) and the write path (deriving the snapshot). The client sends only raw answer text
keyed by question id; `section`/`prompt`/`questionSetVersion` are all derived
**server-side** in `buildSelfEvaluationEntries` — accepting them from the client would let
a crafted payload store a fabricated prompt above a real answer.

Two things are deliberately **not** snapshotted:

- **`guidance`** (the sub-bullets under each prompt) — scaffolding for whoever is
  *writing*, not part of what was asked; a reader of a saved record has no use for it.
- **the rating's option labels** — `selfRating` is a pgEnum *value*, so its label is
  looked up at render. That is correct for a closed value set: the meaning rides the
  stored value, not the wording.

`questionId` is typed **`string`** on the read side, not the id union: a stored row may
hold a since-retired id, and typing it as the union would make those rows unrepresentable
and push every reader toward a cast. The *write* path validates against the union. Blank
answers are **omitted entirely**, so `answers.length` is the answered count.

### 3. `selfRating` is a typed column, not a jsonb entry

It is the only answer with a **closed value set** (so the DB can actually constrain it),
the only one anything will ever aggregate or filter on, and the one a list row must
**badge without parsing jsonb**. This is precisely the `staff_rating.level` (typed
column) vs `staff_rating.subratings` (jsonb, validated at the zod/action layer) split of
ADR 0042 — applied again, for the same reasons.

It is **`notNull`**, which is what guarantees no record is entirely empty: every
free-text answer may legitimately be blank.

### 4. The scale reuses peer feedback's TS tuple but declares its own pg type

`selfEvaluationRatingEnum` is built from `FEEDBACK_RATINGS` — one TypeScript source of
truth for the five words, per ADR 0016 — but registers a **separate Postgres type**,
`self_evaluation_rating`, rather than reusing `feedback_rating`. Sharing the pg type
would mean peer-feedback churn forces an `ALTER TYPE` on a type **two tables** depend on;
the shared *tuple* already prevents the drift that ADR 0016 cares about. Only the
option **descriptions** are re-written here (`SELF_RATING_DESCRIPTIONS`), because peer
feedback's are phrased about someone else.

### 5. Reads: own always; anyone else needs `ratings.view`. Writes: author only

`getStaffSelfEvaluations(staffId)` checks **self first** (it decides `canCreate` /
`canManage`, so a capability holder on their own profile must get the write
affordances), then `ratings.view`. Anyone else gets **`null`**, and no tab is rendered at
all — `[]` means "permitted, nothing written yet". Keeping those distinct matters: a tab
that appeared for everyone would itself disclose that self-evaluations exist.

**Writes have no capability path and no admin override.** `authorizeSelfEvaluationMutate`
(the `ActionAuthorize` hook on update/delete, gating on `clientInput.evaluationId` and
resolving the subject server-side) permits **the author and nobody else** — deliberately
unlike `reviewNoteAccess`, where `admin` *is* a blanket override because a manager
writing about someone *else* needs an escalation route. A self-evaluation is a
first-person document with **no separate author column**, so a third-party edit would be
putting words in someone's mouth, undetectably. `ratings.view` grants reading and nothing
more; `ratings.edit` means "assign levels" and does not apply here. If HR ever needs a
retraction path, that is a separate, audited action — not a widening of this hook.

`createSelfEvaluation` carries **no gate beyond `secureActionClient`'s auth**, and that is
not an omission: its input has **no target id**, the subject comes from
`getCurrentStaffId()`, and an `authorize` hook would have no `clientInput` field to read.

The hook resolves the caller with **plain `ownStaffId`, not `activeOnly: true`**, because
this is an **ownership** check — the caller's identity is used only to compare against
their *own* row. See [permissions.md](../domains/permissions.md) → *Resolving the caller*.

There is **no draft/submitted lifecycle** (a product decision, not a technical one): the
first Save publishes to every `ratings.view` holder, `SELF_EVALUATION_SAVE_WARNING` says
so above the button, and **Delete is the only retraction** — which is another reason
deletion is the author's call alone. The named retrofit if this proves wrong is
`performanceReviewNote`'s `status`/`sharedAt` pair: one nullable column and one `where`
clause.

### 6. Editing is refused once the question set moves on

`SELF_EVALUATION_QUESTION_SET_VERSION` (a plain integer column, so "how many rows still
answer the v1 questions" is a plain query) is bumped whenever the *meaning* of the set
changes. The form shows only **current** questions and the update replaces `answers`
**wholesale**, so editing an older record would silently drop its answers to retired
questions and re-label the survivors — data loss on an edit, the very failure §2 exists to
prevent.

So a stale record is refused on **both** sides: `canManage` is false for it in the read
(no Edit button), and `updateSelfEvaluation` **re-reads `questionSetVersion` from the DB**
and rejects by name (never trusting the client for state — the `requireDraftPlan`
discipline). **Delete stays available** regardless of version, so a stale record is never
stuck. This never fires today: v1 is the only set that has existed.

### 7. ADR 0032 is **not** weakened

This slice reuses `ratings.view` — the capability guarding manager-assigned L0–L4 levels
that a staffer **must never see about themselves** — for data that has a **full owner
path**. That is only coherent because the two guard **different things**: a self-rating is
the person's own five-word self-assessment, on a different scale, written by them; a
`staff_rating` level is a judgement made about them.

The invariants that keep them apart, stated so they can be checked:

- **`getStaffSelfEvaluations` must never join `staff_rating` or project a level.**
- **The Self-evaluations tab must never render an assigned level beside a self-rating.**
- The drawer keeps them as **two separate tabs** — *Self-evaluations* (their words) and
  *Evaluations* (`getStaffEvaluationHistory`, `ratings.view` with **no** owner path).

**"Show the assigned level for comparison" is the single change that would quietly end
ADR 0032.** It is the obvious next feature request and it must be refused, or ADR 0032
must be reopened deliberately.

## Consequences

- **`ratings.view` is wider than the reporting line, and that is a chosen asymmetry.**
  Any `ratings.view` holder can read *any* person's self-evaluation, while that same
  manager's **review notes** about the same conversation are reporting-line-gated
  (ADR 0049) and therefore **narrower**. Net effect: **a person's own words are more
  widely readable than their manager's notes about them.** That follows directly from
  matching the Evaluations tab's gate rather than inventing a third one, and it is
  recorded rather than fixed: a narrower gate would need either a new capability (a
  matrix change) or a second relationship gate, which ADR 0049 explicitly wants to stay
  the only one.
- **No matrix change.** `src/lib/auth/permissions.ts`, `src/lib/auth/permissions.test.ts`
  and permissions.md's matrix table are **untouched**; ADR 0014's lockstep rule isn't
  engaged. permissions.md carries prose instead.
- **The profile tab set widens again** — 5 to 8 tabs on `/staff/[id]` ⁄ `/profile`, and 3
  to 9 in the profile drawer (six viewer-dependent). Anything keying off the tab set must
  tolerate that. See [staff-profiles.md](../domains/staff-profiles.md).
- **The drawer renders the panel `readOnly`** — a host *display* constraint, not
  permission logic: a seven-textarea form inside a 56rem sheet layered over a mid-edit
  plan editor is the wrong place to write one, and "Open full profile" is the way. The
  rejected alternative was forcing `canCreate: false` inside `loadStaffProfileDrawer`,
  which would put a presentation decision inside a gate.
- **Changing the questions needs no migration** — the set lives in the pure,
  client-importable `src/lib/performance/self-evaluation.ts` (a `Record` keyed by the id
  union, so `tsc` fails if an id has no question). But **renaming a `questionId` is a data
  migration, and a retired id must never be reused** for a different question, or old
  records would claim to answer something they don't.
- **The seed is a real drift guard.** `seedSelfEvaluations` calls the *actual*
  `buildSelfEvaluationEntries`, so a question-set change that breaks the stored shape
  fails `bun run check` rather than shipping.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Store answers in the generic `responses` table | `unique(staffId, questionId)` + upsert = one current answer per question; a periodic record needs N rows per occasion, and ADR 0028's "orphaned ids stop being read" is data loss for a dated snapshot (§1) |
| Effective-date it like `staff_rating` | Nothing supersedes anything — a self-evaluation is a document, not a current fact about a person (same call as `performance_review_note`) |
| Render prompts from the current question set at read time | Misattributes today's wording to yesterday's answer; retired questions vanish and new ones appear as phantom blanks (§2) |
| Put `selfRating` in the `answers` jsonb for uniformity | The one closed-value answer, the one thing that will be aggregated, and the one a list row must badge — a typed column is what ADR 0042 already concluded (§3) |
| Reuse the `feedback_rating` pg type | Couples two tables' DDL: a peer-feedback scale change would `ALTER TYPE` under self-evaluations. The shared TS tuple already prevents drift (§4) |
| A new `selfEvaluations.*` capability | Nothing to grant: the owner path covers the author, and reviewers are exactly the Evaluations-tab audience. A matrix row would be a third way to say `ratings.view` (§5) |
| Let admins edit others' self-evaluations (as with review notes) | With no separate author column, a third-party edit is undetectable — putting words in someone's mouth. Escalation belongs in a separate audited action (§5) |
| Migrate old records forward when the question set changes | The point of the snapshot is that old records aren't rewritten. Refusing the *edit* (and keeping delete) is the honest option (§6) |
| Show the manager-assigned level next to the self-rating | Ends ADR 0032 by the back door (§7) |
