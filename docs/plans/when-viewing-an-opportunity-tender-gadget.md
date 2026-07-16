# Opportunity detail drawer: tabbed read view with per-field inline editing

## Context

Today, clicking an opportunity card opens a right-side Sheet
(`src/components/crm/opportunity-detail-sheet.tsx`) that is a **full edit form** —
every field is always editable and there's a single Save button. Width is capped at
`max-w-lg`. The projects section is stacked at the bottom of the same form, and a
user can create multiple projects against one opportunity (nullable
`projects.opportunityId`, non-unique index, no server guard).

We want the drawer to read as a **detail view, not a form**:
- Wider drawer (`max-w-3xl`).
- Two tabs — **Info** and **Project plan**.
- Each Info field is **read-only by default** with a per-field Edit button; clicking
  it swaps that one field into an editable control with **Confirm / Cancel**. Confirm
  saves just that field; Cancel discards. This is per-field, not a full form.
- The existing projects functionality moves verbatim into the **Project plan** tab.
- Each opportunity may have **at most one project**.

### Decisions (confirmed)
- **Save mechanism:** reuse the existing full-form `updateOpportunity` action. Each
  field's Confirm rebuilds the full `UpdateOpportunityInput` from the loaded `detail`
  with only that field changed, then executes. No new action or schema. Source + its
  referral picker edit as **one unit** (they're coupled by `refineReferral`).
- **Access:** unchanged — the drawer opens only for `crm.edit` users (the board only
  passes `onOpenCard` when `canEdit`). Inline edit affordances are gated on the same
  flag. No RBAC/board rework.
- **Width:** `max-w-3xl` (~768px).
- **Max 1 project:** prevent creating a second one (DB + server guard + UI). No
  unlink/replace flow.

## Implementation

### 1. Widen the drawer + restructure into a read view with tabs
File: `src/components/crm/opportunity-detail-sheet.tsx`

- Change the `SheetContent` width override at line 76 from
  `data-[side=right]:sm:max-w-lg` → `data-[side=right]:sm:max-w-3xl`.
- Keep the existing load-on-open wiring (`getOpportunityDetail` via `useAction`,
  `detail` state, `refresh` callback) — it's reused as-is.
- Replace the inner `EditForm` (the full form) with a new **`OpportunityDetailView`**
  that renders `Tabs` (`@/components/ui/tabs`) with two `TabsTrigger`/`TabsContent`:
  - **Info** (default tab): a vertical stack of inline-editable field rows (§3).
  - **Project plan**: the project section moved from the current form
    (`opportunity-detail-sheet.tsx:186-245`) — the "Create project" button,
    empty-state note, project display, and `AddProjectDialog` — with the single-
    project UX from §5. Mirror the tab layout of
    `src/components/crm/company-detail-view.tsx:68-190` and reuse `TabLabel` from
    `src/components/crm/detail-parts.tsx` for the tab labels.
- After any successful field save (or project create), call the existing `refresh()`
  so read views reflect the new value; the sheet stays open (drop the current
  `onSaved` close-on-save behavior — inline edits don't close the drawer).

### 2. Reusable inline-edit row primitive
New file: `src/components/form/inline-edit-field.tsx` (colocated with the other
form primitives; built on `FormField`).

A presentational + light-state component: `InlineEditField`.
- Props: `label`, `display` (ReactNode shown in read mode), `children` (the edit
  control(s), shown only in edit mode), `canEdit`, `onConfirm: () => void | Promise`,
  `onCancel`, `isSaving`, `error?`.
- Read mode: renders `label` + `display` with a small ghost **Edit** icon button
  (`IconButton` + `IconPencil`, per `.claude/rules/ui.md` — icon-only buttons need a
  tooltip/label). Uses `FormField`'s `labelAction` slot for the Edit/Confirm/Cancel
  buttons so the label row stays consistent.
- Edit mode: renders `children` (the control) with **Confirm** (`IconCheck`, drives
  `loading` from `isSaving`) and **Cancel** (`IconX`) buttons; shows `error` below.
- Owns only the `editing` boolean; draft values live in each field wrapper (§3).

### 3. The Info-tab fields
Each field is a small wrapper component (defined alongside `OpportunityDetailView`)
that owns its own draft state + its own `useAction(updateOpportunity)` instance, so
pending/error are per-field. Reuse the **existing controls** from
`opportunity-form-fields.tsx` — no new control primitives:

| Field | Read display | Edit control |
|---|---|---|
| Name | text | `Input` |
| Line of business | `LINE_OF_BUSINESS_LABELS[v]` | `EnumSelect` (LINE_OF_BUSINESS) |
| Owners | names, else muted "None" | `EntityMultiCombobox` + `searchStaff` |
| Contacts | names, else "None" | `ContactsComboboxField` |
| Source (+ referral) | `SOURCE_LABELS[v]` + referral names when applicable | `EnumSelect` (sources) **and** conditional `EntityMultiCombobox`/`ContactsComboboxField` — one combined unit |
| Status | `OpportunityStatusBadge` (already used in company view) | `EnumSelect` (statuses, `STATUS_SELECT_LABELS`) |
| Next steps | text, else "None" | `Textarea` |

Shared helper (in the same file): `detailToInput(detail): UpdateOpportunityInput`
mapping `detail` → the full action input (EntityRef[] → id arrays), mirroring
`opportunityValuesToInput` in `opportunity-form-fields.tsx:54`. Each field's Confirm
builds `{ ...detailToInput(detail), <its field(s)>: draft, id: detail.id }`,
runs `updateOpportunitySchema.safeParse` for a light client check (map the relevant
issue onto the field via the existing `OPPORTUNITY_FIELD_FOR_ISSUE`), then
`execute(parsed.data)`. On success: exit edit mode + `refresh()`.

- **Status field guard:** keep the client mirror of the delivery-stage rule
  (`opportunity-detail-sheet.tsx:158-163`, using `requiresProject` +
  `detail.projects.length > 0`) inside the Status field's Confirm, surfacing the same
  message as a field error. The server enforces it regardless.
- **Source unit:** on source change, clear the non-matching referral draft (mirrors
  `opportunity-form-fields.tsx:193-199`) so `refineReferral` passes.

### 4. Max 1 project — DB
File: `src/lib/db/projects-schema.ts` (line ~66)

Replace the non-unique `projects_opportunity_idx` with a **partial unique index** on
`opportunityId` where it is not null (nullable column — standalone projects share
`NULL` and must stay allowed):
`uniqueIndex("projects_opportunity_idx").on(t.opportunityId).where(sql\`${t.opportunityId} is not null\`)`.
Then `bun run db:generate` → `bun run db:migrate` (per `.claude/rules/database.md`).
(The Neon DB is assumed already migrated for existing state; verify no opportunity
currently has >1 project before applying — see Verification.)

### 5. Max 1 project — action guard + UI
- Action: `src/actions/projects/createProject.ts` — when `parsedInput.opportunityId`
  is set, reuse the existing `opportunityHasProject` helper
  (`src/actions/crm/opportunityHasProject.ts`) and
  `throw new UserSafeActionError("This opportunity already has a project.")` before
  insert (inside the transaction, mirroring the existing `requiresProject` guard
  style in `updateOpportunity.ts:43-52`). The DB unique index is the true race-proof
  guard; this gives a friendly message.
- UI (Project plan tab): hide the "Create project" button once
  `detail.projects.length > 0`; render the single linked project (`detail.projects[0]`)
  instead of a list. The board's delivery-stage prompt already only fires when
  `!current.hasProject` (`opportunity-board.tsx`), so it needs no change.
- Keep `OpportunityDetail.projects` as an array in the read model (minimal churn;
  the constraint guarantees ≤1); the UI simply renders the first.

### Files touched
- `src/components/crm/opportunity-detail-sheet.tsx` — width, tabs, read view, wiring.
- `src/components/form/inline-edit-field.tsx` — **new** inline-edit primitive.
- `src/actions/projects/createProject.ts` — one-project server guard.
- `src/lib/db/projects-schema.ts` (+ generated migration) — partial unique index.
- Reused unchanged: `updateOpportunity` action + schema, `opportunity-form-fields.tsx`
  controls, `OPPORTUNITY_FIELD_FOR_ISSUE`, `EnumSelect`/`EntityMultiCombobox`/
  `ContactsComboboxField`/`FormField`, `OpportunityStatusBadge`, `TabLabel`,
  `opportunityHasProject`, `AddProjectDialog`.

## Verification

1. `bun run check` (Biome + `tsc` + tests) and `bun run build`.
2. `bun run dev`, open `/opportunities`, click a card:
   - Drawer is visibly wider (~768px), shows **Info** / **Project plan** tabs.
   - Info fields render read-only; each has an Edit button. Edit → Confirm saves that
     field and returns to read mode with the new value; Cancel discards. Verify a text
     field (Name), an enum (Line of business), a people picker (Owners), the Status
     badge, and the coupled **Source → referring staff/contacts** unit.
   - Status: try moving to Allocating/later with no project → blocked with the
     delivery-stage message; with a project → allowed.
   - Board card reflects saved status/name after Confirm (via `revalidatePath`).
3. Project plan tab: create a project → it appears and the **Create project** button
   disappears. Attempt a second project (and via the DB) → rejected with the friendly
   message; unique index blocks it at the DB layer.
4. Before generating the migration, confirm no existing opportunity has >1 linked
   project (a quick `db:studio`/query check) so the unique index applies cleanly.
5. After the feature lands, dispatch the **librarian** subagent to reconcile
   `docs/domains/crm.md` (drawer UX, per-field editing) and the projects one-per-
   opportunity constraint.
