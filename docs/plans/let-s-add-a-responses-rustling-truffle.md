# Generic `responses` table + "Manual of Me" profile section

## Context

Staff profiles need a **"Manual of Me"** — 7 free-text reflection questions (how I like feedback, my superpowers, what helps me thrive, etc.) that a person fills out so teammates and managers can work with them well. The answers are written to be **shared with the team**, like the existing Client intro field.

Rather than bolt 7 columns onto `staff`, we add a **generic `responses` table** keyed by `(staffId, questionId)` — reusable survey infrastructure. Manual of Me is its first consumer; future surveys reuse the same table and action with no schema change.

Two goals shape the UX (per user):
- The **editing experience is a guided, one-question-at-a-time page** — not an intimidating wall of textareas — so people take care answering and don't get overwhelmed. Answers **autosave per step** so anyone can stop and come back later (the stress question literally invites this).
- Answers are **visible to anyone who can view the profile** (same posture as Client intro / Résumé). Editing stays self-only + `staff.edit` holders, matching every other profile field.

## Design decisions

- **`questionId` is plain `text()`, not a `pgEnum`.** The table is deliberately survey-agnostic; a pgEnum would force an `ALTER TYPE ... ADD VALUE` migration per new question (already documented as painful in this repo). Validity is enforced at the **zod layer** against the app-owned id tuple. Value source-of-truth lives in a pure lib module, matching how `skills` / `line-of-business` are modelled.
- **`UNIQUE (staffId, questionId)`** — one answer per person per question. Enables idempotent `onConflictDoUpdate` upsert (mirrors the `timesheets_staff_week_unique` precedent). A survey answer is a *current value*, not append-only history.
- **Arrays as `jsonb().$type<string[]>()`** — the repo has no Postgres `text[]`; `staff.skills` is the precedent.
- **No new permission-matrix resource.** Writes reuse the existing `authorizeStaffEdit` hook (`src/actions/staff/canEditStaff.ts`), which reads `staffId` off `clientInput` (owner always; others need `staff.edit`). Nothing in `permissions.ts` / `permissions.test.ts` / `docs/domains/permissions.md` changes.

## Files to create

### 1. `src/lib/db/responses-schema.ts` — new generic schema module
```ts
export const responses = pgTable(
  "responses",
  {
    id: text().primaryKey(),                                   // generateId("response")
    staffId: text().notNull().references(() => staff.id, { onDelete: "cascade" }),
    questionId: text().notNull(),                              // validated in zod, not a pgEnum
    listResponse: jsonb().$type<string[]>(),                   // list-type questions
    textResponse: text(),                                      // free-text questions
    jsonResponse: jsonb(),                                     // complex answers
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique("responses_staff_question_unique").on(t.staffId, t.questionId),
    index("responses_staff_idx").on(t.staffId),
  ],
);
export type Response = InferSelectModel<typeof responses>;
```
All three response columns nullable — a row uses whichever shape its question needs (Manual of Me uses `textResponse` only). Add a header comment explaining the generic intent. Then add `export * from "./responses-schema";` to the barrel **`src/lib/db/schema.ts`**.

### 2. `src/lib/manual-of-me.ts` — pure source of truth (client-importable, no `server-only`)
- `MANUAL_OF_ME_QUESTION_IDS` const tuple (the 7 ids, in the order the user provided — this is **display order**).
- `MANUAL_OF_ME_QUESTIONS`: ordered array of `{ id, title, subtitle, type: "text" }` — the 7 titles/subtitles from the request, sorted to the tuple order.
- `manualOfMeQuestionId = z.enum(MANUAL_OF_ME_QUESTION_IDS)` — reusable questionId validator. Future surveys export their own const/enum; a shared action can accept a `z.union([...])` of them.

### 3. `src/actions/responses/getManualOfMe.ts` — server-only read (wrap in `React.cache`)
`getManualOfMe(staffId): Promise<ManualOfMeEntry[]>` where `ManualOfMeEntry = { id, title, subtitle, textResponse: string | null }`. One `db.select` projecting only `{ questionId, textResponse }` filtered by `staffId` + `inArray(questionId, [...MANUAL_OF_ME_QUESTION_IDS])`; left-join into the ordered question defs via a Map so all 7 always render (unanswered → `null`). Not ownership-scoped (profiles are viewable — the `(app)` layout is the auth boundary), matching `getStaffProfile`.

### 4. `src/actions/responses/upsertResponse.schema.ts` + `upsertResponse.ts`
Schema (`z.object`): `{ staffId: id, questionId: manualOfMeQuestionId, textResponse: optionalTrimmedText(10_000, "…") }`. `optionalTrimmedText` maps a cleared textarea (`""`) → `null`.

Action (`"use server"`, `secureActionClient`):
```ts
.metadata({ action: "upsert-response", authorize: authorizeStaffEdit })
.inputSchema(upsertResponseSchema)
.action(async ({ parsedInput: { staffId, questionId, textResponse } }) => {
  await db.insert(responses)
    .values({ id: generateId("response"), staffId, questionId, textResponse })
    .onConflictDoUpdate({ target: [responses.staffId, responses.questionId], set: { textResponse } });
  revalidatePath("/profile");
  revalidatePath(`/staff/${staffId}`);
  return { ok: true };
});
```
`target` matches the unique constraint (timesheets precedent). Kept tight to text; the schema/table stay extensible to `listResponse`/`jsonResponse` for future surveys.

### 5. `src/app/(app)/staff/[id]/manual-of-me/page.tsx` — guided edit page (mirror the skills page)
Server component modeled on `src/app/(app)/staff/[id]/skills/page.tsx`: `metadata.title = "Manual of Me"`; `Promise.all([getStaffProfile(id), getCurrentUser(), getCurrentStaffId(), getManualOfMe(id)])`; `if (!profile) notFound()`; compute `canEdit = user ? await canEditStaff(user, id) : false` and **`if (!canEdit) notFound()`** (non-editors can't reach anyone's editor). Back-to-profile button + heading, then `<ManualOfMeGuide staffId={id} entries={manualOfMe} />`.

### 6. `src/components/staff/manual-of-me-guide.tsx` — `"use client"` guided experience
Imperative `useAction(upsertResponse)` (mirrors `edit-skills-form.tsx`; full-page editors use `useAction`, not `useHookFormAction`). Component tree:
- **Step indicator** (top): `"Question {n} of 7"` + a hand-rolled flat progress element (row of thin `bg-primary`/`bg-muted` segments — no Progress/Stepper primitive is vendored; keep it flat per the design language). Optional jump-nav listing all 7 with an `IconCheck` on answered ones.
- **Question panel**: title (`font-heading`), subtitle (`text-muted-foreground`), auto-growing `<Textarea>` (`min-h-48`), and a subtle inline `Saving… / ✓ Saved` indicator (**not** a toast per step).
- **Controls**: Back (disabled at step 0) · Next / **Done** on last step → `router.push(`/staff/${staffId}`)`.

State: `answers[]` (init from entries), `savedValues[]` (last-persisted per step), `step`, `saveState`. **Per-step save** on Next/Back/Done and textarea `onBlur`, plus an ~800ms debounced autosave while typing; skip the save when the value is unchanged vs `savedValues[i]`. **Race guard:** capture the sent value in the `onSuccess` closure and only mark "Saved" if the field still equals it at resolve. `useAction.isExecuting` serializes overlapping saves. Best-effort save on unmount; copy states answers are optional and resumable (no `beforeunload` heroics).

### 7. `src/components/staff/manual-of-me-section.tsx` — presentational (read view for the card)
Takes `entries: ManualOfMeEntry[]`. Empty state (`"No Manual of Me answers yet."` muted) when none answered; otherwise maps answered entries → title (`font-medium`) + answer in `text-sm whitespace-pre-wrap` (mirrors Résumé/Client-intro rendering).

## Files to modify

- **`src/components/staff/profile-view.tsx`** — add `manualOfMe: ManualOfMeEntry[]` prop; add a **"Manual of Me" `<Card>`** near the other narrative cards. `CardContent` renders `<ManualOfMeSection>` + a subtle `"{answered} of 7 answered"` hint. When `canEdit`, `CardAction` renders the Edit button as a link — copy the skills-card pattern exactly:
  ```tsx
  <Button variant="ghost" size="sm" nativeButton={false}
    render={<Link href={`/staff/${staffId}/manual-of-me`} />}>
    <IconPencil /> Edit
  </Button>
  ```
  Uses the resolved `staffId` prop, so `/profile` links to `/staff/{selfId}/manual-of-me` correctly.
- **`src/app/(app)/profile/page.tsx`** — add `getManualOfMe(staffId)` to the `Promise.all` after `staffId` resolves; pass `manualOfMe` to `<ProfileView>`.
- **`src/app/(app)/staff/[id]/page.tsx`** — add `getManualOfMe(id)` to its `Promise.all`; pass `manualOfMe` to `<ProfileView>`.

## Edge cases

- **Unanswered / cleared answers** — no row (or `textResponse: null`); the read left-fills all 7, the card shows a muted empty state, the count reflects non-null answers.
- **Autosave race / debounce** — discrete-transition + blur + debounced saves; in-flight closure reconciles the "Saved" marker; `isExecuting` serializes; no per-keystroke spam.
- **Viewing someone else's Manual of Me** — read is not ownership-scoped, so answers show read-only on `/staff/[id]`; the editor page `notFound()`s non-editors and `authorizeStaffEdit` is the real write boundary.
- **Crafted `questionId`** — rejected by `z.enum(...)` before the action body runs.

## Build & verify

1. Create `src/lib/manual-of-me.ts` and `src/lib/db/responses-schema.ts`; add the `export *` to `src/lib/db/schema.ts`.
2. `bun run db:generate` → **review the generated `drizzle/NNNN_*.sql`** (unique constraint name, FK cascade) → `bun run db:migrate`.
3. Create the actions, then the UI components + page, then wire `profile-view.tsx` and the two route pages.
4. `bun run check` (Biome + `tsc` + tests, incl. the RBAC matrix) then `bun run build`.
5. **Manual smoke:** `/profile` shows the card + count → Edit → guided page; type, navigate steps (see "Saved"), **reload to confirm persistence**; open another person's `/staff/[id]` (card read-only, no Edit); hit `/staff/[otherId]/manual-of-me` directly as a non-editor → 404. Use the `/run` skill to drive the flow in the real app.
6. After code lands, **dispatch the `librarian`** to update `docs/domains/staff-profiles.md` (the generic `responses` table, the `(staffId, questionId)` upsert grain, the `src/lib/manual-of-me.ts` source of truth, the guided edit page) and add a short ADR in `docs/decisions/` for the generic survey-responses modelling choice (why one generic table + app-validated `text` questionId over per-survey tables or a pgEnum).
