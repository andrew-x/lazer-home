# Opportunities Kanban Board

## Context

The opportunities pipeline is today a flat 7-value status enum (`maturing, lead,
qualifying, scoping, closing, closed_lost, closed_won`) rendered as a paginated
table. We want to (1) restructure statuses into **groups with ordered substatuses**
and (2) replace the table with a **kanban board** — draggable cards, columns per
group that collapse into one column (with a substatus badge per card) or expand
into sub-columns, drag-and-drop reordering within and across columns, and a name
search box. Manual card order must persist across reloads, so we add a `position`
schema field. Drag-and-drop uses **dnd-kit**.

Decisions confirmed with the user:
- **Won/Lost** become two **separate terminal columns** at the end of the pipeline.
- Multi-substatus groups render **collapsed by default**.
- The board **replaces** the current table + pagination on `/opportunities`.

## New pipeline structure (groups → ordered substatuses, in pipeline order)

| # | Group | Substatuses (leaf enum values) |
|---|-------|--------------------------------|
| 1 | Maturing | `maturing` |
| 2 | Lead | `lead` |
| 3 | Qualifying | `qualifying` |
| 4 | Scoping | `scoping_awaiting_info`, `scoping`, `scoping_reviewing` |
| 5 | Allocating | `allocating_awaiting_profiles`, `allocating_introing_profiles` |
| 6 | Negotiating | `negotiating` |
| 7 | Closing | `closing_awaiting_contracts`, `closing_redlining`, `closing_awaiting_signatures` |
| 8 | Won | `closed_won` |
| 9 | Lost | `closed_lost` |

The flat `OPPORTUNITY_STATUSES` tuple is listed **in this exact order** — array index = pipeline position; the pgEnum and the group indices both derive from it.

## Design decisions

- **Status stays a single `pgEnum` column.** Groups are *derived* in code (like `line-of-business.ts`), not a second column. A single flat enum keeps one source of truth and lets the pgEnum stay in lockstep.
- **Ordering = one global fractional index**, `position doublePrecision NOT NULL DEFAULT 0`. Any column (collapsed group, expanded sub-column, or plain column) sorts by "filter to this column's status set, order by `position` asc." On drop we write the midpoint between the destination neighbors — **one row updated per move**, no server renumber. float8 gives ~50 midpoints between the same pair, far beyond this scale.
- **Optimistic UI via `useState` snapshot-revert**, not `useOptimistic` (unused in repo and would fight dnd-kit). Canonical state is a flat card collection; **columns are derived each render** so collapse/expand never re-keys stored state. Because the move action stores the exact `{status, position}` we sent, `onSuccess` is a no-op; `onError` reverts to the snapshot + `router.refresh()`.
- **dnd-kit classic v6 API** (`DndContext` / `SortableContext` / `useSortable`) — NOT the `@dnd-kit/react` v0 beta that Context7 currently documents.

## Implementation

### 1. Pipeline enum + groups (SSOT)
- **Edit `src/actions/crm/createOpportunity.schema.ts`** — replace `OPPORTUNITY_STATUSES` with the full flat list above, in pipeline order (drives both the Zod enum and the pgEnum in `crm-schema.ts`).
- **New `src/lib/opportunity-pipeline.ts`** (pure, client-importable, mirrors `src/lib/line-of-business.ts`): export `OPPORTUNITY_GROUPS` (`{ id, label, statuses }[]` in pipeline order), derived lookups (`GROUP_INDEX_BY_ID`, `GROUP_ID_BY_STATUS`, `groupIndexOfStatus`), and `resolveTargetStatus(...)` (below). Add a module-load assertion that `OPPORTUNITY_GROUPS.flatMap(g => g.statuses)` deep-equals `OPPORTUNITY_STATUSES` (order included) to keep the two structures locked together.
- **Edit `src/components/crm/opportunity-display.ts`** — extend `STATUS_LABELS` (typed `Record<OpportunityStatus,string>`, so TS forces completeness) with all new leaf labels (e.g. `scoping_awaiting_info: "Awaiting info"`).

### 2. Schema + migration
- **Edit `src/lib/db/crm-schema.ts`** — add `position: doublePrecision().notNull().default(0)` to `opportunities` and index `("opportunities_status_position_idx").on(t.status, t.position)`.
- **Migration (hand-written — `drizzle-kit generate` cannot do this correctly).** Postgres can't drop/reorder enum values, so:
  1. Create `opportunity_status_new` with the full ordered value list.
  2. `ALTER TABLE opportunities ALTER COLUMN status TYPE opportunity_status_new USING (...)` — remap legacy values: `scoping → scoping`, `closing → closing_awaiting_contracts`, all others (incl. `closed_won`/`closed_lost`) map to themselves.
  3. Drop old type; rename new → `opportunity_status`.
  4. Add `position` column; backfill `position = row_number() over (partition by status order by created_at)`.
  - Run `bun run db:generate` first to scaffold the position column, then hand-edit the enum portion; verify with `bun run db:migrate`. (Dev data is negligible — app is create-only/scaffolded — so the remap is low-risk.)

### 3. Actions
- **New `src/actions/crm/updateOpportunityPosition.ts`** (+ `.schema.ts`): `secureActionClient.metadata({ action: "update-opportunity-position", permission: { crm: ["edit"] } })`, input `{ id: string, status: z.enum(OPPORTUNITY_STATUSES), position: z.number() }`, body updates `{ status, position }` by id, `revalidatePath("/opportunities")`. Carries both status + position (within-column reorder just resends the same status).
- **Edit `src/actions/crm/createOpportunity.ts`** — inside the existing transaction set `position = (max(position) where status = :status) + 1` (append to the column's end).
- **New `src/actions/crm/getOpportunitiesBoard.ts`** (`import "server-only"`): a non-paginated mirror of `getOpportunitiesPage` — same company `innerJoin` + single grouped owner-name query (no N+1), drop `count`/`clampPage`/`limit`/`offset`, `.orderBy(asc(position), asc(createdAt))`. Return `BoardCard[]` = `{ id, name, companyName, status, source, ownerNames, position }`.

### 4. Board UI
- **`package.json`**: `bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`.
- **Edit `src/app/(app)/opportunities/page.tsx`** — fetch `getOpportunitiesBoard()` + `getCurrentUser()`; render `<OpportunityBoard cards={...} canEdit={canEdit} />`, replacing `OpportunitiesTable` + `PaginationControls`.
- **New `src/components/crm/opportunity-board.tsx`** (`"use client"`) — owns card state, `expanded` map (multi-status groups default collapsed), the search `Input` (leading `IconSearch`, filter cards by name in a derived list — mirror `staff-directory.tsx`), and `DndContext` (PointerSensor `{ distance: 5 }` so link/clicks survive + KeyboardSensor; `closestCorners`; `measuring.droppable: Always` so empty columns accept drops). Derives columns from cards+expanded; renders `<DragOverlay>` with a static card clone. When `!canEdit`, render the same columns without `DndContext`/sensors (static board).
- **New `src/components/crm/opportunity-board-column.tsx`** — `useDroppable` (id `status:<s>` or `group:<groupId>`), header with collapse/expand `IconButton` (Tabler icon + `label`) for multi-status groups, `SortableContext` (`verticalListSortingStrategy`).
- **New `src/components/crm/opportunity-card.tsx`** — `useSortable({ id })`; shows name, company, owners; shows a substatus `Badge` when in a collapsed multi-status column.

### 5. Create dialog
- **Edit `src/components/crm/add-opportunity-dialog.tsx`** — the status select now offers the full leaf-status list; group the options by `OPPORTUNITY_GROUPS` labels (or default new opps to `lead`). Keep it minimal.

## Key algorithms (put in `opportunity-pipeline.ts` / board)

**`computePosition(D, k)`** — `D` = destination column cards sorted by position, dragged card removed; `k` = insertion index:
```
before = k>0 ? D[k-1].position : null;  after = k<D.length ? D[k].position : null
if (!before && !after) return 0            // empty column
if (before == null)    return after - 1    // drop at start
if (after == null)     return before + 1   // drop at end
return (before + after) / 2                // midpoint
```

**`resolveTargetStatus(targetColumn, originStatus)`** — `originStatus` captured at drag start:
```
if targetColumn.kind == "status": return targetColumn.status   // sub-column or plain/terminal column
group = OPPORTUNITY_GROUPS[targetColumn.groupId]               // collapsed multi-status group
oi = groupIndexOfStatus(originStatus);  di = GROUP_INDEX_BY_ID[group.id]
if oi == di: return originStatus                                // reorder within same collapsed group
if oi <  di: return group.statuses[0]                           // from EARLIER → first substatus
else:        return group.statuses[last]                        // from LATER   → last substatus
```

**onDragEnd**: find dest column + insertion index `k` → `newStatus = resolveTargetStatus(...)` → `newPosition = computePosition(D, k)` → optimistically `setCards` → `move.execute({ id, status: newStatus, position: newPosition })`. onDragCancel/onError revert to the pre-drag snapshot.

## Constraints to honor
- Actions layer only for DB access; reads are `server-only` `get<Thing>.ts`, mutations gated in `.metadata` (`crm.edit`) — never in the body (`.claude/rules/{server-actions,permissions,database}.md`).
- shadcn on **Base UI** (`render` prop, not `asChild`); Tabler icons only; icon-only buttons via `IconButton` with a `label`; sharp corners, flat in-page surfaces, indigo sparingly, light mode (`.claude/rules/ui.md`).
- `reactCompiler: true` — do **not** hand-add `useMemo`/`useCallback`; if dnd-kit transforms go stale, the escape hatch is `"use no memo"` at the top of the board component (contingency only).
- After the schema/data-model change, dispatch the **librarian** subagent to reconcile `/docs` (crm domain + data-model).

## Verification
1. `bun run db:generate` → hand-edit enum migration → `bun run db:migrate`; confirm the column type and `position` backfill in `db:studio`.
2. `bun run check` (Biome + tsc + tests — includes the pipeline lockstep assertion and the RBAC matrix) and `bun run build`.
3. `bun run dev`, open `/opportunities`: verify columns render in pipeline order, multi-status groups collapsed with substatus badges; expand a group into sub-columns; drag a card within a column (order persists after reload); drag across columns (status updates); drag into a collapsed group from an earlier column (→ first substatus) and from a later column (→ last substatus); search by name filters cards; a non-editor sees a static board (no drag).
4. Run `/code-review` and `/audit-rbac` (new mutating action) before shipping.
