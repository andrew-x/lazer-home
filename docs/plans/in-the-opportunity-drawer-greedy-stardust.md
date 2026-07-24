# Opportunity drawer: merge Info+Notes into two columns + card nav

## Context

The opportunity detail drawer (opened from the opportunities kanban board) currently
splits its content across three tabs — **Info**, **Notes**, and **Project plan**. Info
and Notes are viewed together in practice (you read the meta while triaging notes/next
steps), so tabbing between them is friction. Two changes:

1. **Merge Info + Notes** into a single view — a left meta column (the Info fields) and a
   right column (Next steps + Notes) — and widen the drawer to fit both comfortably.
   Project plan stays a separate tab.
2. **Add prev/next navigation** to the drawer's left-edge control strip (under the close
   button) so you can step through the opportunities in the same kanban column without
   closing and reopening. Only shown when the column has more than one card.

Decisions confirmed with the user: keep Project plan as a second tab; **disable** prev/next
at the ends (no wrap-around); step through **only the visible (search-filtered)** cards.

## Files

- `src/components/crm/opportunity-detail-sheet.tsx` — drawer shell, tabs, control strip.
- `src/components/crm/opportunity-board.tsx` — owns `selectedId` + the per-column card maps;
  computes neighbours and passes handlers into the drawer.

No schema, action, or permissions changes. The drawer only mounts for `crm.edit` users
(gated on the board today) — that stays unchanged.

## Change 1 — Two-column Details view + wider drawer

In `opportunity-detail-sheet.tsx`:

- **Widen the sheet.** On `<SheetContent>` (line ~108) change
  `data-[side=right]:sm:max-w-[64rem]` → `data-[side=right]:sm:max-w-[80rem]` (1024px → 1280px).
  It stays `w-full`, so it's still full-width (and stacks) on small screens.
- **Restructure `OpportunityDetailView`** (lines 164–238): keep the `<Tabs>` but with two
  triggers — **`Details`** (`value="details"`, the new default) and **`Project plan`**
  (`value="project-plan"`, unchanged). Drop the separate `info` and `notes` triggers/contents.
- The **Details** `TabsContent` is a responsive grid:
  `grid grid-cols-1 gap-6 pt-4 lg:grid-cols-[18rem_1fr] lg:gap-8` (single column on small
  screens; meta column ~18rem + notes fill on `lg`+, which is where the 80rem drawer has room).
  - **Left cell** — the existing Info stack, unchanged blocks:
    `LineOfBusinessField`, `SourceField`, `CompanyField`, `ContactsField`, `OwnersField`
    (wrap in `flex flex-col gap-4`).
  - **Right cell** — the existing two `EntryLog` sections (Next steps, then Notes), unchanged
    (`flex flex-col gap-6`).
- These blocks are already self-contained (`detail` + `refresh` props), so this is a JSX move,
  not a rewrite. `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, `InlineEditField`, and
  `EntryLog` are all reused as-is. The `key={detail.id}` on `OpportunityDetailView` (line 145)
  stays — it resets field state when navigating to a neighbour (see Change 2).

## Change 2 — Prev/next control strip

In `opportunity-detail-sheet.tsx`:

- Add optional props to `OpportunityDetailSheet`: `onPrev?: () => void` and
  `onNext?: () => void`. A handler is `undefined` when that direction is unavailable
  (first/last card), and **both** are undefined when the column has one card.
- Replace the standalone `<SheetClose>` (lines 115–126) with a vertical control strip:
  a container absolutely positioned on the left edge (`absolute top-4 left-0 z-10 flex
  flex-col`, reusing the existing edge treatment — `bg-popover`, hairline border, and the
  `lg:-translate-x-full` outside-hang) holding, top to bottom:
  1. the existing `SheetClose` (`IconX`),
  2. a **prev** `IconButton` (`IconChevronUp`, label `Previous opportunity`),
  3. a **next** `IconButton` (`IconChevronDown`, label `Next opportunity`).
  Vertical chevrons match the column's vertical orientation (prev = card above, next = below).
  Match the close button's `size="icon-sm"` / `w-8` so the strip reads as one unit.
- Render the prev/next buttons **only when** `onPrev || onNext` is set (i.e. column has
  siblings). Each button is `disabled` when its handler is `undefined` (boundary), per the
  "disable at ends" decision. Icons from `@tabler/icons-react`; icon-only buttons use
  `IconButton` per the UI rule.

In `opportunity-board.tsx` (already holds `selectedId`, `columnIdByCard`, `visibleByColumnId`):

- Derive neighbours in render, from the **visible** list (respects the active search filter):
  ```
  const selColId = selectedId ? columnIdByCard.get(selectedId) : undefined;
  const siblings = selColId ? (visibleByColumnId.get(selColId) ?? []) : [];
  const idx = siblings.findIndex((c) => c.id === selectedId);
  const prevId = idx > 0 ? siblings[idx - 1].id : null;
  const nextId = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1].id : null;
  ```
- Pass into `<OpportunityDetailSheet>` (lines 492–497):
  `onPrev={prevId ? () => setSelectedId(prevId) : undefined}` and the same for `nextId`.
  Changing `selectedId` while `open` stays true re-runs the drawer's load effect
  (deps include `opportunityId`), so the neighbour's detail fetches automatically.
- Edge case handled by construction: if the selected card is filtered out of view
  (`idx === -1`), both are `null` → the nav strip hides.

## Verification

- `bun run check` (Biome + tsc + tests) and `bun run build`.
- Manually via `bun run dev` on `/opportunities`:
  - Open a card in a column with several opportunities. Confirm the drawer is wider, and
    Info (left) + Next steps/Notes (right) sit side by side on a wide viewport and stack on a
    narrow one. Confirm inline-editing a field and adding a note still work.
  - Confirm the **Project plan** tab still switches and works.
  - Confirm prev (▲) / next (▼) appear under the close button, step through the column in
    order, and disable on the first/last card. Editing a field then navigating shows the
    neighbour's own values (state resets).
  - Open a card in a single-card column → no prev/next buttons.
  - Type a search that filters a column, then open a remaining card → prev/next steps only
    through the still-visible cards.
- After merging, dispatch the **librarian** subagent to reconcile `/docs` (the CRM domain /
  UI docs describe the drawer's tabs).
