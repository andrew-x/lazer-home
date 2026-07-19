# Ways of Working (WOW) survey

## Context

We want a new self-service profile survey — **"Ways of Working"** — where each person
records how they work: the editors/tools they use, how they learn, and a detailed set of
AI-usage questions (kinds of work, AI tools, problems, confidence, output-kept, and a
7-question engineering-workflow deep dive). The questions and option lists come verbatim
from another app's "AI survey" + "skills survey"; here we **merge both into one survey**
and prefix every question id with `WOW_`.

This is deliberately the *second consumer* of the generic `responses` table, which
[ADR 0028](../decisions/0028-generic-responses-table-app-validated-question-ids.md) built
for exactly this: "a future survey adds its own const tuple + defs module and reuses the
same table and `upsertResponse` action." So this is a **code-only change — no DB
migration.** We mirror the existing **"Manual of Me"** feature end-to-end.

Confirmed product decisions:
- **Editor UX:** sectioned guided editor (mirror `ManualOfMeGuide` — step rail, autosave per field).
- **AI matrix:** grid table — each item row has a Usage control (Critical/Common/Avoid) and a Savings control (Major/Minor/None), Savings enabled only once a usage tag is set.
- **Visibility:** any signed-in teammate can view (same as Manual of Me / the rest of the profile); editing is self + `staff.edit` (managers/admins).

## Data model — reuse `responses`, no migration

Answers live in the existing `responses` table (`src/lib/db/responses-schema.ts`), keyed
`(staffId, questionId)`, upserted. Each `WOW_` question uses exactly one payload column:

- **`textResponse`** — free text, single-select dropdowns (store the chosen label string).
- **`listResponse`** (`jsonb string[]`) — multi-selects and every matrix bucket.

### The 28 `WOW_` question ids (define in one `as const` tuple = display + validation order)

| Section | Question id(s) | Shape |
|---|---|---|
| Editors & Learning | `WOW_PREFER_IDE`, `WOW_PREFER_LEARNING` | list |
| Resources & Side Projects | `WOW_RESOURCES`, `WOW_SIDE_PROJECTS` | text |
| AI — Types of Work | `WOW_CRITICAL_TYPE_OF_WORK`, `WOW_COMMON_TYPE_OF_WORK`, `WOW_AVOID_TYPE_OF_WORK`, `WOW_MAJOR_SAVINGS_TYPE_OF_WORK`, `WOW_MINOR_SAVINGS_TYPE_OF_WORK`, `WOW_NO_SAVINGS_TYPE_OF_WORK` | list |
| AI — Tools | `WOW_CRITICAL_TOOL`, `WOW_COMMON_TOOL`, `WOW_AVOID_TOOL`, `WOW_MAJOR_SAVINGS_TOOL`, `WOW_MINOR_SAVINGS_TOOL`, `WOW_NO_SAVINGS_TOOL` | list |
| AI — Problems | `WOW_FREQUENT_PROBLEM`, `WOW_RARE_PROBLEM` | list |
| AI — Confidence & Output | `WOW_GENERAL_CONFIDENCE`, `WOW_CODE_CONFIDENCE`, `WOW_DOCUMENT_KEEP`, `WOW_CODE_KEEP` | text (single-select) |
| Engineering Workflows | `WOW_ENGINEERING_WORKFLOW_PROJECT_CONTEXT`, `..._AI_SETUP`, `..._CONFIG_EVOLUTION`, `..._COMPLEX_FEATURE`, `..._DEBUGGING_AI_OUTPUT`, `..._REVIEW_VERIFICATION`, `..._OTHER` | text |
| Other | `WOW_OTHER_THOUGHTS` | text |

The grid maps to storage by decomposition: each Types-of-Work item lands in exactly one
of the three usage lists (or none) and one of the three savings lists (or none). On read,
membership in those six lists reconstructs each item's usage/savings. Same for Tools.

## Files to create

### 1. `src/lib/ways-of-working.ts` — pure, client-importable defs (mirror `src/lib/manual-of-me.ts`)
No `db` import. Exports:
- Option constants **verbatim from the request**: `IDES`, `LEARNING`, `AI_SURVEY_TYPES_OF_WORK`, `AI_SURVEY_TOOLS`, `AI_SURVEY_PROBLEMS`, `AI_SURVEY_GENERAL_CONFIDENCE`, `AI_SURVEY_CODE_CONFIDENCE`, `AI_SURVEY_OUTPUT`, `AI_SURVEY_ENGINEERING_WORKFLOW_INTRO`, `AI_SURVEY_ENGINEERING_WORKFLOW_QUESTIONS` (rename ids to the `WOW_` prefix).
- `WAYS_OF_WORKING_QUESTION_IDS` — the `as const` tuple of all 28 ids above (canonical order).
- `waysOfWorkingQuestionId = z.enum(WAYS_OF_WORKING_QUESTION_IDS)` — validator reused by the action schema.
- A `WOW_SECTIONS` structure describing the 8 editor steps as a discriminated union on `kind`: `"multiselect"` (questionId + options), `"text"` (questionId + title/subtitle/placeholder), `"single-selects"` (list of {questionId,label,options}), `"problems"` (two multiselects over `AI_SURVEY_PROBLEMS`), `"matrix"` (groups + the six usage/savings ids), `"workflow"` (the 7 workflow text questions + intro copy). The guide switches on `kind`; the read-only section reuses it for display order.

### 2. `src/actions/responses/getWaysOfWorking.ts` — read (mirror `getManualOfMe.ts`)
`import "server-only"`, wrapped in `React.cache`. Select `questionId, textResponse, listResponse`
`where inArray(questionId, [...WAYS_OF_WORKING_QUESTION_IDS])`. Return a map
`Record<WowQuestionId, { textResponse: string | null; listResponse: string[] | null }>`
(all ids present, defaulting null) plus an `answeredCount`. Export `WaysOfWorkingResponses` type.
Not ownership-scoped — same as `getManualOfMe` (auth is the `(app)` layout).

### 3. `src/components/staff/use-response-autosave.ts` — shared autosave engine
Extract the queue/drain logic currently inside `manual-of-me-guide.tsx` into a reusable
hook keyed by **string questionId** with a per-field shape (`"text" | "list"`). Returns
`{ answers, saved, setAnswer, flushField, flushAll, saveStateFor }`. It calls
`upsertResponse` per dirty field with the right payload column. Preserves the existing
behavior (debounced typing, blur, navigation, unmount, in-flight re-dirty, error retry).
**Then migrate `ManualOfMeGuide` to consume it (behavior-preserving)** so there's one copy
of the tricky save loop, not two. Verify Manual of Me still autosaves after the refactor.

### 4. `src/components/staff/ways-of-working-guide.tsx` — the guided editor (`"use client"`)
Mirrors `ManualOfMeGuide`'s shell (`StepRail`, Back/Next, Done→`/staff/${staffId}`,
`SaveIndicator`) but steps are **sections**, driven by `WOW_SECTIONS` + `useResponseAutosave`.
Per-`kind` field renderers:
- **multiselect / problems** — grouped/flat toggle-chips (badge-as-button, selected = filled), mirroring the chip pattern in `edit-skills-form.tsx`; toggling updates that id's list and flushes.
- **matrix** — a grid per group (General/Engineering/Design…). Each row = item + a Usage segmented control (`ToggleGroup type="single"`, values critical/common/avoid) + a Savings segmented control (major/minor/no), Savings disabled until Usage set; clearing Usage clears that item's Savings. Row state is derived from the six lists (single source of truth); a change edits the relevant lists and flushes those ids. Reuse the inline segmented-toggle look from `edit-skills-form.tsx` (the "Add as" control) or `toggle-group.tsx`.
- **single-selects** — `Select` primitives (or `EnumSelect`) bound to `textResponse`.
- **text / workflow** — `Textarea` with debounced autosave (as Manual of Me); the workflow step shows `AI_SURVEY_ENGINEERING_WORKFLOW_INTRO` guidance/sequence copy above its 7 textareas.

A section shows as "done" in the rail when any of its fields has a saved value.

### 5. `src/components/staff/ways-of-working-section.tsx` — read-only profile view (mirror `manual-of-me-section.tsx`)
Renders answered content grouped by section: IDEs/learning/problems as badges, the two
matrices as grouped item lists annotated with usage + savings, dropdowns as labeled values,
textareas as paragraphs. Empty state when nothing answered; skip unanswered fields.

### 6. `src/app/(app)/staff/[id]/ways-of-working/page.tsx` — editor route (mirror `.../manual-of-me/page.tsx`)
Parallel reads via `Promise.all`, `canEditStaff` gate → `notFound()`, render
`<WaysOfWorkingGuide staffId responses={...} />`, `export const metadata`.

## Files to modify

- **`src/actions/responses/upsertResponse.schema.ts`** — widen `questionId` to `z.union([manualOfMeQuestionId, waysOfWorkingQuestionId])`; make `textResponse` optional and add optional `listResponse: z.array(z.string().max(200)).max(200)`. (This is the extension point the file's own comment calls out.)
- **`src/actions/responses/upsertResponse.ts`** — accept `listResponse`; write both columns in `values` and `onConflictDoUpdate.set` (normalize empty text/list → `null`, so each row keeps one populated column). **Authorization is unchanged** — still `authorizeStaffEdit` reading `staffId`. Do **not** touch the gate.
- **`src/components/staff/profile-view.tsx`** — add a `<TabsTrigger value="ways-of-working">Ways of Working</TabsTrigger>` + matching `<TabsContent>` (clone the Manual of Me tab block, lines 306–332): render `<WaysOfWorkingSection>`, an "N of M answered" line, and a `canEdit`-gated Edit/"Fill out" `<Button render={<Link href={`/staff/${staffId}/ways-of-working`} />}>`. Add the read result + answered count to the component's props.
- **`src/app/(app)/profile/page.tsx`** and **`src/app/(app)/staff/[id]/page.tsx`** — add `getWaysOfWorking(staffId)` to the parallel fetch and pass it into `<ProfileView>`.

## Non-goals / notes
- **No migration, no schema change** — `responses` already has all three payload columns and is already in the seed wipe list. Seeding WOW demo data is **optional** (only if Manual of Me is already seeded — check `scripts/seed/`); skipping it does not break `bun run check` since the model is unchanged.
- **RBAC unchanged** — no new permission, no new role, matrix/`permissions.test.ts`/`docs/domains/permissions.md` untouched. Reuse `authorizeStaffEdit`.
- Single-selects are stored as `textResponse`; the UI constrains input to the option list (not security-sensitive, so no per-question enum validation in the generic action).

## Verification
1. `bun run check` (Biome + `tsc` + tests) and `bun run build`.
2. Run the app (`bun run dev`), sign in, open **/profile → Ways of Working → Fill out**:
   - Multi-selects (IDE/learning/problems) toggle and persist; reload shows them selected.
   - AI matrix: set a Usage tag → Savings unlocks; clearing Usage clears Savings; reload reconstructs the grid.
   - Single-selects (confidence/output) and all textareas autosave; the step rail marks sections done.
   - "Done" returns to the profile; the read-only tab shows a correct summary and "N of M answered".
3. Confirm **Manual of Me still autosaves** after the shared-hook refactor (regression check).
4. Open another person's profile as a non-manager: the tab is **visible/read-only**; the Edit link is absent. As a manager, the Edit link appears and saving works. Confirm a crafted `WOW_` id for a `staffId` you can't edit is rejected by `authorizeStaffEdit`.
5. Run **`/audit-rbac`** (schema of a gated action changed) — expect no findings.
6. After merge, **dispatch the `librarian` subagent** to reconcile `/docs` (staff-profiles domain: document the WOW survey as the second `responses` consumer; note the widened `upsertResponse`).
