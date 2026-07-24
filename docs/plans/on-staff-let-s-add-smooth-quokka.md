# Allocation notes on staff + inline editor in the planner

## Context

Staffers/managers want a lightweight place to jot planning notes about a
person's allocation ("On bench after Aug 15, wants frontend work", "roll off
Acme early", etc.) right where they do capacity planning. Today the
**Allocations planner** (`/allocations`) is a read-only weekly grid of staff ×
project allocations with no per-person free-text.

This adds a single `allocationNotes` string field to the `staff` record and
surfaces it as an **editable column immediately right of the staff name** in the
planner, autosaving on debounce as you type.

**Access decision (confirmed with the user):** allocation notes are private
planning metadata. Because the planner page is otherwise visible to *every*
signed-in user, the notes column is **shown and edited only by users with the
`staff.edit` capability (managers + admins)** — hidden entirely for everyone
else. This is a pure capability gate; `staff.edit` already exists in the role
matrix (`src/lib/auth/permissions.ts`), so **no permission-matrix change is
needed** (no edits to `permissions.ts` / `permissions.test.ts` / the permissions
doc). We deliberately do **not** use the owner-or-`staff.edit` `authorizeStaffEdit`
gate here — a person self-editing one row of a management planner isn't the
intent; managers edit anyone.

**Editor UX (confirmed):** a textarea that grows vertically with content but is
fixed-width (fills the cell, no horizontal resize), autosaving on debounce.

## Data model

**`src/lib/db/staff-schema.ts`** — add one nullable free-text column to the
`staff` table, mirroring the existing `location` / `clientIntro` pattern
(`text()`, nullable, no default, camelCase key → `allocation_notes`):

```ts
allocationNotes: text(),
```

No `updatedAt` sibling — this is a plain note, not a surfaced-timestamp field
like `clientIntro`. Then run the standard migration flow:
`bun run db:generate` → `bun run db:migrate`.

**Seed — `scripts/seed/staff.ts`:** keep the seed in lockstep (per AGENTS.md).
Add a value in the admin (Andrew) row (~lines 115–130) and in `buildStaff(...)`
(~lines 219–254), following the existing `hasIntro`-style chance pattern, e.g.
`allocationNotes: chance(0.4) ? faker.lorem.sentence() : null`.

## Server: read + write (actions layer)

### Write — new action (mirrors `updateStaffClientIntro`)

**`src/actions/staff/updateStaffAllocationNotes.schema.ts`** — hand-written,
client-importable (the grid cell imports it), no drizzle:

```ts
import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import { optionalTrimmedText } from "@/lib/schemas/text-schema";

export const updateStaffAllocationNotesSchema = z.object({
  staffId: id,
  allocationNotes: optionalTrimmedText(2000, "Keep notes under 2000 characters."),
});
```

**`src/actions/staff/updateStaffAllocationNotes.ts`** — `'use server'`,
`secureActionClient`, gated by the **static capability** (not `authorizeStaffEdit`):

```ts
.metadata({
  action: "update-staff-allocation-notes",
  permission: { staff: ["edit"] },
})
```

Body: `db.update(staff).set({ allocationNotes }).where(eq(staff.id, staffId)).returning({ id })`,
then `assertStaffUpdated(rows)` (from `staffProfileMutation.ts`) and
`revalidatePath("/allocations")` (the only page that shows the field — no need
for `revalidateStaffProfile`).

### Read — `src/actions/allocations/getAllocationsGrid.ts`

- Add `allocationNotes: staff.allocationNotes` to the `staffRows` `.select({...})`.
- `currentUser` is already fetched for the PTO disclosure. Compute
  `const canEditNotes = currentUser ? userHasPermission(currentUser, { staff: ["edit"] }) : false;`
- Add `canEditNotes: boolean` to `AllocationsGridData` and `allocationNotes: string | null`
  to `AllocationStaffRow`. **Only populate the note when permitted** (defense in
  depth so it never ships to unprivileged clients):
  `allocationNotes: canEditNotes ? s.allocationNotes : null`.

## Grid math — `src/lib/allocations/allocations-grid.ts`

Thread the field through (pure, no gating logic here):
- Add `allocationNotes: AllocationStaffRow["allocationNotes"]` to the
  `AllocationRow` type.
- In `buildAllocationRows`, copy `allocationNotes: person.allocationNotes` onto
  each built row.

## UI

### New cell — `src/components/allocations/allocation-note-cell.tsx` (`"use client"`)

A self-contained debounced-autosave editor for one row's note:
- Props: `{ staffId: string; initialNotes: string | null }`.
- Local `value` state seeded from `initialNotes`; `useAction(updateStaffAllocationNotes)`.
- **Debounce:** reuse `useDebouncedValue(value, 600)` from `src/hooks/useDebouncedValue.ts`,
  and in a `useEffect` fire `execute({ staffId, allocationNotes: debounced })`
  only when `debounced` differs from a `lastSavedRef` (guards the initial mount
  and no-op saves), updating the ref on change. Simpler single-field analog of
  `use-response-autosave.ts` — the full queued engine is overkill for one field.
- **Auto-grow, fixed-width textarea:** use the shadcn `Textarea`
  (`@/components/ui/textarea` — add via `bunx --bun shadcn@latest add textarea`
  if not already vendored), `rows={1}`, `resize-none`, full-cell width; auto-grow
  height via a ref that sets `style.height = scrollHeight` on value change. Flat
  styling to sit in the table (borderless or subtle border, per `ui.md` — sharp
  corners, no shadow).
- **Save status:** a small muted inline indicator driven by `isExecuting` /
  `result` (e.g. "Saving…" → "Saved", errors via `result.serverError`). Keep it
  subtle; model the affordance on `response-save-indicator.tsx` but inline.

### Grid — `src/components/allocations/allocations-grid.tsx`

Add a `canEditNotes: boolean` prop. When true only:
- In `<thead>`, render a second `<th>` **"Notes"** right after the sticky "Staff"
  header (before the week columns), e.g. `min-w-56`.
- In each `<tr>`, render a matching `<td>` right after the sticky staff `<td>`
  containing `<AllocationNoteCell staffId={row.staffId} initialNotes={row.allocationNotes} />`.
- When `canEditNotes` is false, render neither (column absent for non-editors).

Keep the notes column as a normal (non-sticky) second column — a fixed
`min-w-56`/`max-w-72` so the textarea's width is bounded and it grows only
vertically. (Making it sticky alongside the staff name is a possible follow-up
for keeping notes in view while scrolling weeks, but adds horizontal cost; not in
scope.)

### Container + page — thread the flag

- **`src/components/allocations/allocations-planner.tsx`:** add `canEditNotes` to
  props and pass it to `<AllocationsGrid ... canEditNotes={canEditNotes} />`.
  `filteredStaff` → `buildAllocationRows` already carries `allocationNotes` via
  `AllocationStaffRow`/`AllocationRow`, so no filter changes.
- **`src/app/(app)/allocations/page.tsx`:** pass `canEditNotes={data.canEditNotes}`
  to `<AllocationsPlanner />`.

## Files touched (summary)

- `src/lib/db/staff-schema.ts` — new `allocationNotes` column
- `drizzle/` — generated migration (`db:generate`)
- `scripts/seed/staff.ts` — seed the new column
- `src/actions/staff/updateStaffAllocationNotes.ts` + `.schema.ts` — new gated action
- `src/actions/allocations/getAllocationsGrid.ts` — select + `canEditNotes` + gated projection
- `src/lib/allocations/allocations-grid.ts` — thread `allocationNotes` through the row type
- `src/components/allocations/allocation-note-cell.tsx` — new debounced editor cell
- `src/components/allocations/allocations-grid.tsx` — conditional Notes column
- `src/components/allocations/allocations-planner.tsx` + `src/app/(app)/allocations/page.tsx` — thread `canEditNotes`

## Verification

1. `bun run db:generate && bun run db:migrate`, then `bun run db:seed` — confirm
   the seed stays green (it imports the real tables; a stale seed fails `check`).
2. `bun run check` (Biome + `tsc` + tests) and `bun run build`.
3. **Manual, via `/run`** (or `bun run dev`):
   - As a **manager/admin**: open `/allocations`, confirm a "Notes" column sits
     right of each name; type a note → it autosaves on debounce (watch the
     status indicator / a network call to `update-staff-allocation-notes`);
     reload → the note persists; the textarea grows vertically as you add lines
     and does not widen.
   - As a **plain `user`** (or any role without `staff.edit`): confirm the Notes
     column is **absent** and the note value is never sent to the client.
   - Confirm directly invoking `updateStaffAllocationNotes` as a non-`staff.edit`
     user is rejected (`result.serverError`) — the server gate, not just the UI.
4. After merge, dispatch the **librarian** subagent to reconcile `/docs`
   (`docs/domains/allocations.md`, `docs/domains/staff.md`, data-model) with the
   new field and the manager-only notes column.
