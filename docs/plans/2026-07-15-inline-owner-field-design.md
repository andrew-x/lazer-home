# Inline, editable Owner on company & contact pages

**Date:** 2026-07-15
**Status:** implemented

> **Design correction (post-review):** the original plan reused the full-record
> `updateCompany`/`updateContact` for the inline owner edit (mirroring the
> opportunity drawer). A high-effort code review flagged two confirmed correctness
> bugs in that approach: (1) it silently reverts other fields changed concurrently
> (writes the whole page-load snapshot), and (2) on a contact it re-runs
> `assertValidManager`, so a contact in the reachable `companyId=null,
> managerId=set` state (company deleted → FK sets `companyId` null) can't have its
> owner reassigned. **Fix:** dedicated owner-only actions `updateCompanyOwner` /
> `updateContactOwner` (each writes only `ownerId`), precedent
> `updateOpportunityPosition`. The sections below describe the shipped design.

## Goal

On the **company** and **contact** detail pages, give Owner a dedicated spot that
is **editable in place on the page** — the same interaction as the opportunity
detail drawer — **instead of** editing it inside the Edit dialog.

## Background (current state)

- Owner is a single staff member: `companies.ownerId` / `contacts.ownerId`
  (`text().references(() => staff.id, { onDelete: "set null" })`, nullable).
- Company page (`src/components/crm/company-detail-view.tsx`, a Server Component)
  shows `Owner: {ownerName ?? "Unassigned"}` as a plain header subtitle line;
  owner is edited only in `EditCompanyDialog`.
- Contact page (`src/components/crm/contact-detail-view.tsx`, a Server Component)
  shows Owner as a read-only row in the Details card; edited only in
  `EditContactDialog`.
- The opportunity drawer (`src/components/crm/opportunity-detail-sheet.tsx`)
  edits every field in place with the shared **`InlineEditField`**
  (`src/components/form/inline-edit-field.tsx`) primitive: read-as-text until a
  pencil is clicked, then a control with confirm/cancel. Its owner field is
  *multi*-select (`EntityMultiCombobox`) because opportunities have many owners.
- Both `updateCompany` and `updateContact` are **full-record** actions gated on
  `crm.edit`, and both `revalidatePath` their detail route after a write. Their
  schemas (`updateCompany.schema.ts`, `updateContact.schema.ts`) already include
  `ownerId: id.nullable().default(null)`.
- `searchStaff` (`src/actions/crm/searchStaff.ts`, gated `crm.edit`) is the
  type-ahead source of selectable owners; `EntityCombobox`
  (`src/components/form/entity-combobox.tsx`) is the single-select picker.

## Design

### New shared component: `InlineOwnerField`

`src/components/crm/inline-owner-field.tsx` (`"use client"`). One component serving
both entities, discriminated by `kind`:

```tsx
type Props = {
  canEdit: boolean;
  ownerId: string | null;
  ownerName: string | null;
} & (
  | { kind: "company"; base: Omit<UpdateCompanyInput, "ownerId"> }
  | { kind: "contact"; base: Omit<UpdateContactInput, "ownerId"> }
);
```

Behaviour, mirroring the drawer's `useInlineSave` pattern but specialised to one
single-select field:

- Holds `editing` state + a draft `{ id, name }` for the picker.
- `useAction(kind === "company" ? updateCompany : updateContact, { onSuccess: () => setEditing(false) })`.
- Renders `InlineEditField` (`label="Owner"`, `canEdit`, `isSaving={isPending}`,
  `error={result.serverError}`, display = `ownerName ?? "Unassigned"` muted).
- Edit control is `EntityCombobox` + `searchStaff` directly (NOT
  `OwnerComboboxField`, which wraps its own `FormField`/label and would
  double-label inside `InlineEditField`) — matching how the drawer uses
  `EntityMultiCombobox` bare inside `InlineEditField`.
- On confirm: `execute({ ...base, ownerId: draftId })` — reuses the existing
  full-record action, so no new/partial action is needed. On cancel: reset draft,
  close.

Only the minimal serializable `base` fields are passed from the Server Component
detail views — never the full `CompanyDetail`/`ContactDetail` (which carry nested
arrays) and never a closure (which can't cross the RSC boundary).

- Company `base`: `{ id, name, websiteUrl: websiteUrl ?? "", isPartner }`.
- Contact `base`: `{ id, firstName, lastName, email, phone: phone ?? "",
  companyId, role: role ?? "", linkedinUrl: linkedinUrl ?? "", managerId }`.

(These match the create/update schema `z.input` shapes: optional text fields
default to `""`, nullable ids stay `null`. The contact action re-runs
`assertValidManager` — carrying the existing `managerId`/`companyId` through
`base` keeps that check happy on an owner-only change.)

### Placement

- **Contact** — replace the read-only `Owner` `DetailRow` in the Details card with
  `<InlineOwnerField kind="contact" .../>`. Per the approved decision it uses the
  drawer's `InlineEditField` look (label-above-value + pencil), even though the
  sibling rows are label-left/value-right — Owner is the one editable row and is
  meant to read differently.
- **Company** — replace the `Owner: {ownerName ?? "Unassigned"}` subtitle line in
  the header with `<InlineOwnerField kind="company" .../>`.

### Refresh

No manual refetch. `updateCompany`/`updateContact` already `revalidatePath` the
detail route, so the Server Component re-renders with the new owner; the field
closes on `onSuccess`. (The drawer needs manual refetch only because it loads its
detail client-side into state; these pages get owner from server props.)

### Remove Owner from the edit dialogs

`edit-company-dialog.tsx` and `edit-contact-dialog.tsx`: remove the `ownerId`
`Controller` + `OwnerComboboxField`, the `ownerName` local state, and the owner
import.

**Correctness trap — do NOT drop `ownerId` from `defaultValues`.** Both dialogs
submit the *whole* record. If `ownerId` is removed from `defaultValues`, the
schema defaults it to `null` and saving the dialog (e.g. a name edit) would
**silently wipe the owner**. Keep `ownerId: <entity>.ownerId` in `defaultValues`
so the current value round-trips unchanged. Verify explicitly (see Verification).

### Cleanup

- After removal, check `OwnerComboboxField`
  (`src/components/crm/owner-combobox-field.tsx`) usages. If the add-company /
  add-contact dialogs don't use it and the two edit dialogs were its only
  consumers, **delete it** (dead code). If it's still used, leave it.
- No schema changes — `ownerId` stays in both update schemas (the inline field
  relies on it).

## Files touched

| File | Change |
|---|---|
| `src/components/crm/inline-owner-field.tsx` | **new** — shared inline owner editor |
| `src/components/crm/company-detail-view.tsx` | header: subtitle line → `InlineOwnerField`; thread `canEdit` |
| `src/components/crm/contact-detail-view.tsx` | Details card: Owner row → `InlineOwnerField`; thread `canEdit` |
| `src/components/crm/edit-company-dialog.tsx` | remove owner picker; keep `ownerId` in defaults |
| `src/components/crm/edit-contact-dialog.tsx` | remove owner picker; keep `ownerId` in defaults |
| `src/components/crm/owner-combobox-field.tsx` | delete if orphaned after the above |

## Permissions

Unchanged. `InlineOwnerField` shows the edit affordance only when `canEdit`
(the detail views already compute this for the Edit button). The server actions
independently enforce `crm.edit` regardless of the UI — the client gate is a
convenience, not the security boundary.

## Verification

- `bun run check` (Biome + `tsc` + tests) and `bun run build`.
- Manual / `verify` skill:
  - Company page: edit owner inline (assign, reassign, clear) — persists and shows
    after reload; pencil hidden for a non-`crm.edit` user.
  - Contact page: same.
  - Edit dialog regression: open Edit dialog, change only the name, save —
    **owner must be unchanged** (the defaults trap).
- Dispatch the `librarian` subagent afterward to reconcile `/docs` (CRM domain doc)
  with the moved owner-editing affordance.

## Out of scope

- Add-company / add-contact dialogs (owner-on-create unchanged).
- The opportunity drawer (already inline; multi-owner).
- Any schema / data-model change.
