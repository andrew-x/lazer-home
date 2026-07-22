# 0028 — One generic `responses` table with app-validated question ids, not per-survey tables or a pgEnum

**Status:** accepted · 2026-07-15

## Context

The first "survey-style" feature — **Manual of Me** (7 free-text reflection
prompts a person fills out on their profile) — needed somewhere to store answers.
More such surveys are foreseeable (onboarding questionnaires, working-style
inventories, review intake). Two obvious shapes:

- **A table per survey** (`manual_of_me`, one nullable text column per question),
  or a wide `staff` add-on — a fresh migration for every new survey *and* every
  question added to an existing one.
- **A generic answers table keyed by a `questionId` `pgEnum`** — no per-survey
  table, but growing the enum means an out-of-band `ALTER TYPE ... ADD VALUE`
  (which can't run inside a transaction — see the currency-enum gotcha in
  [domains/staff-profiles.md](../domains/staff-profiles.md)), so every new
  question still touches the schema.

The set of questions is small, curated by us in code, and changes with the app —
the same situation that made the skills catalogue an in-code list
([ADR 0018](./0018-skills-inline-jsonb-catalogue.md)).

## Decision

One **generic `responses` table** (`src/lib/db/responses-schema.ts`), keyed by
**`(staffId, questionId)`**, where **`questionId` is plain `text`** validated at
the **zod layer** against app-owned id tuples — never a `pgEnum`, never a per-survey
table. Adding a survey or a question needs **no migration**.

- **`questionId` validity lives in code**, in a pure client-importable module per
  survey — `src/lib/staff/manual-of-me.ts` is the first (`MANUAL_OF_ME_QUESTION_IDS`,
  `MANUAL_OF_ME_QUESTIONS`, the `manualOfMeQuestionId` zod enum). Same
  single-source discipline as `@/lib/staff/skills` / `@/lib/crm/line-of-business`: one module
  feeds the read layer, the `upsertResponse` action's schema, and the client UI.
  `upsertResponse.schema.ts` validates `questionId` against that enum, so a crafted
  id can't write an arbitrary row.
- **Three nullable response shapes** on each row — `listResponse` (`jsonb`
  `string[]`), `textResponse` (`text`), `jsonResponse` (`jsonb`) — a question uses
  whichever its type needs. Manual of Me (all free text) uses `textResponse` only;
  the schema is deliberately scoped to the text case for now (widen `questionId`
  to a `z.union([...])` of each survey's enum and add the list/json shapes as more
  surveys arrive).
  (**Update, 2026-07-18 — this widening has now happened, on schedule:** the second
  survey, **Ways of Working** (`src/lib/staff/ways-of-working.ts`, 28 `WOW_`-prefixed ids),
  landed as a **code-only** change — no migration. `upsertResponse.schema.ts`'s
  `questionId` is now `z.union([manualOfMeQuestionId, waysOfWorkingQuestionId])`, and
  the action accepts an optional `listResponse: string[]` alongside `textResponse`,
  writing the used column and nulling the other. Free-text/single-select answers use
  `textResponse`; multi-selects and the AI usage/savings matrix buckets use
  `listResponse`. Each future survey appends its enum to the union; `jsonResponse`
  is still unused. See [domains/staff-profiles.md](../domains/staff-profiles.md) →
  *Ways of Working*.)
- **The grain is a *current value* per (person, question), not history.** A
  `unique(staffId, questionId)` constraint makes writes an **upsert**
  (`onConflictDoUpdate`), so the guided editor saves each question independently
  and re-saves freely. This is the **opposite** of the `feedback` table, which is
  an immutable point-in-time event log ([ADR 0023](./0023-feedback-privacy-tiers.md)) —
  a survey answer is the latest reflection, not an append-only record.
- **An unanswered question has no row.** The read (`getManualOfMe`) left-merges
  the stored rows onto the in-code question list, so callers always get all
  questions with `textResponse: null` where unanswered. Clearing an answer sends
  `"" → null` and keeps the row.
- **No new RBAC surface.** Reading is not ownership-scoped (profiles are visible
  to any signed-in viewer, like `getStaffProfile`); writing reuses the existing
  `authorizeStaffEdit` hook (own profile always; others need `staff.edit`). The
  permission matrix is unchanged.

## Consequences

- **New surveys are a code-only change** — a defs module + reusing `responses` and
  `upsertResponse`. No schema churn, no `ALTER TYPE`.
- **No DB-level guarantee that `questionId` is valid** — validity is a zod
  invariant, so all writes must go through the action layer (they do; ADR 0010).
  An orphaned id (a question removed from code) simply stops being read, since the
  read filters by the current in-code id list.
- **No answer history / effective dating** — like skills (ADR 0018), an edit
  overwrites. If "how did this answer change over time" ever matters, this is the
  gap; the generic table would need an append grain or a sibling history table.
- **One table serves many surveys**, so cross-survey reads must filter by the
  survey's id set (`inArray(questionId, MANUAL_OF_ME_QUESTION_IDS)`) — cheap, and
  indexed by `responses_staff_idx` on `staffId`.

## Alternatives considered

- **Per-survey table (or wide columns on `staff`)** — rejected: a migration per
  survey and per added question, and schema sprawl as surveys multiply. No query
  benefit while access is always "this person's answers to this survey".
- **`questionId` as a `pgEnum`** — rejected: gives a DB-level check but reintroduces
  the out-of-band, non-transactional `ALTER TYPE ... ADD VALUE` dance on every new
  question, defeating the "no migration per survey" goal. Zod validation on
  app-owned tuples is enough given all writes go through the action layer.
- **Append-only answers (like `feedback`)** — rejected for this grain: a Manual of
  Me answer is a current value the author edits in place, not an event. Upsert keeps
  the read trivially "one row per question".
