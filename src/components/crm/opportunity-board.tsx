"use client";

import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { IconArrowsMinimize, IconSearch } from "@tabler/icons-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import type { OpportunityBoardCard } from "@/actions/crm/getOpportunitiesBoard";
import { updateOpportunityPosition } from "@/actions/crm/updateOpportunityPosition";
import { createProjectFromOpportunity } from "@/actions/projects/createProjectFromOpportunity";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ALL, FilterLabel, SelectFilter } from "@/components/form/filters";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
} from "@/lib/crm/line-of-business";
import { type OpportunityStatus, STATUS_LABELS } from "@/lib/crm/opportunity";
import {
  CAPPED_BOARD_STATUSES,
  computePosition,
  type DropTarget,
  groupOfStatus,
  OPPORTUNITY_GROUPS,
  type OpportunityGroup,
  type OpportunityGroupId,
  requiresProject,
  resolveTargetStatus,
} from "@/lib/crm/opportunity-pipeline";
import {
  type ColumnShowMore,
  OpportunityBoardColumn,
} from "./opportunity-board-column";
import { CardDragHandle, OpportunityCardView } from "./opportunity-card";
import { OpportunityDetailSheet } from "./opportunity-detail-sheet";

/** A status move waiting on a project being created for the opportunity. */
type PendingMove = { id: string; status: OpportunityStatus; position: number };

type ProjectPrompt = {
  opportunityId: string;
  opportunityName: string;
  pendingMove: PendingMove;
};

type BoardColumn = {
  id: string;
  label: string;
  target: DropTarget;
  statuses: readonly OpportunityStatus[];
  showSubstatusBadge: boolean;
};

type BoardUnit =
  | {
      kind: "column";
      group: OpportunityGroup;
      expandable: boolean;
      column: BoardColumn;
    }
  | { kind: "expanded"; group: OpportunityGroup; columns: BoardColumn[] };

/** Build the layout units (and, flattened, the droppable columns) per group. */
function buildUnits(
  expanded: Partial<Record<OpportunityGroupId, boolean>>,
): BoardUnit[] {
  return OPPORTUNITY_GROUPS.map((group) => {
    if (group.statuses.length === 1) {
      const status = group.statuses[0];
      return {
        kind: "column",
        group,
        expandable: false,
        column: {
          id: `status:${status}`,
          label: group.label,
          target: { kind: "status", status },
          statuses: group.statuses,
          showSubstatusBadge: false,
        },
      };
    }
    if (expanded[group.id]) {
      return {
        kind: "expanded",
        group,
        columns: group.statuses.map((status) => ({
          id: `status:${status}`,
          label: STATUS_LABELS[status],
          target: { kind: "status", status },
          statuses: [status],
          showSubstatusBadge: false,
        })),
      };
    }
    return {
      kind: "column",
      group,
      expandable: true,
      column: {
        id: `group:${group.id}`,
        label: group.label,
        target: { kind: "group", groupId: group.id },
        statuses: group.statuses,
        showSubstatusBadge: true,
      },
    };
  });
}

/**
 * The opportunities kanban board. Cards are the canonical state; columns are
 * derived from the pipeline groups + which groups are expanded, so toggling
 * collapse never re-keys stored state. Drag moves are optimistic: the drop
 * computes an absolute `{ status, position }`, applies it locally, and persists
 * it; on error we revert to the pre-drag snapshot (the failed write left the DB
 * unchanged, so the snapshot is authoritative).
 */
export function OpportunityBoard({
  cards: initialCards,
  cappedTotals,
  canEdit,
  canCreateProject,
}: {
  cards: OpportunityBoardCard[];
  /** Full per-status counts for the capped columns (see `getOpportunitiesBoard`). */
  cappedTotals: Partial<Record<OpportunityStatus, number>>;
  canEdit: boolean;
  canCreateProject: boolean;
}) {
  const searchId = useId();
  const [cards, setCards] = useState(initialCards);
  const [expanded, setExpanded] = useState<
    Partial<Record<OpportunityGroupId, boolean>>
  >({});
  const [search, setSearch] = useState("");
  const [lob, setLob] = useState<string>(ALL);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Detail drawer + the delivery-stage "create a project first" prompt.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [projectPrompt, setProjectPrompt] = useState<ProjectPrompt | null>(
    null,
  );

  const snapshotRef = useRef<OpportunityBoardCard[]>(initialCards);
  const originStatusRef = useRef<OpportunityStatus | null>(null);

  // Adopt fresh server data (e.g. after creating an opportunity) without
  // clobbering in-flight optimistic moves: only reset when the server payload
  // actually changes. Our optimistic value equals what the server stores, so a
  // post-move revalidation resolves to identical state.
  // `hasProject` is part of the signature: linking a project via the detail
  // drawer changes it without moving the card, and the board must adopt that so
  // it stops prompting to create a (duplicate) project.
  const signature = initialCards
    .map((c) => `${c.id}:${c.status}:${c.position}:${c.hasProject}`)
    .join("|");
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current !== signature) {
      lastSignature.current = signature;
      setCards(initialCards);
    }
  }, [signature, initialCards]);

  const { execute } = useAction(updateOpportunityPosition, {
    onError: ({ error }) => {
      setCards(snapshotRef.current);
      toast.error(error.serverError ?? "Couldn't move the opportunity.");
    },
  });

  // The delivery-stage prompt creates a project for the opportunity (one-click,
  // inheriting its name + company) then completes the pending status move.
  const createProject = useAction(createProjectFromOpportunity, {
    onSuccess: () => {
      toast.success("Project created.");
      completePendingMove();
    },
    onError: ({ error }) => {
      setProjectPrompt(null);
      toast.error(error.serverError ?? "Couldn't create the project.");
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const units = buildUnits(expanded);
  const columns = units.flatMap((u) =>
    u.kind === "expanded" ? u.columns : [u.column],
  );

  // Sort once by (position, createdAt) — same tie-break as the server query, so
  // a tied position never flips order between renders.
  const sortedCards = [...cards].sort(
    (a, b) => a.position - b.position || a.createdAt - b.createdAt,
  );

  // The full (unfiltered) cards per column drive drag math; the visible subset
  // (search filter applied) is what each column renders. Reordering must use the
  // full neighbours — a drag while searching would otherwise place a card
  // relative to only the visible cards and corrupt its order against hidden ones.
  //
  // Note: the search below only filters the cards already loaded. The capped
  // columns (Maturing/Won/Lost) load just their most-recent slice, so search
  // won't surface cards beyond the cap — the list view is the exhaustive search.
  const query = search.trim().toLowerCase();
  const lobFilter = lob === ALL ? null : lob;
  const columnByStatus = new Map<OpportunityStatus, BoardColumn>();
  for (const col of columns) {
    for (const status of col.statuses) columnByStatus.set(status, col);
  }
  const fullByColumnId = new Map<string, OpportunityBoardCard[]>();
  const visibleByColumnId = new Map<string, OpportunityBoardCard[]>();
  for (const col of columns) {
    fullByColumnId.set(col.id, []);
    visibleByColumnId.set(col.id, []);
  }
  const columnIdByCard = new Map<string, string>();
  for (const card of sortedCards) {
    const colId = columnByStatus.get(card.status)?.id;
    if (!colId) continue;
    fullByColumnId.get(colId)?.push(card);
    columnIdByCard.set(card.id, colId);
    const matchesQuery = !query || card.name.toLowerCase().includes(query);
    const matchesLob = !lobFilter || card.lineOfBusiness === lobFilter;
    if (matchesQuery && matchesLob) {
      visibleByColumnId.get(colId)?.push(card);
    }
  }

  // "Show more" per capped column: those columns load only their most-recent
  // slice, so when the DB holds more than we rendered, offer a link into the list
  // view filtered to that stage. Capped statuses are single-status groups, so a
  // column's loaded (full) count is exactly that status's on-board total.
  const cappedStatuses = new Set<OpportunityStatus>(CAPPED_BOARD_STATUSES);
  const showMoreByColumnId = new Map<string, ColumnShowMore>();
  for (const col of columns) {
    if (col.statuses.length !== 1) continue;
    const status = col.statuses[0];
    if (!cappedStatuses.has(status)) continue;
    const total = cappedTotals[status];
    const loaded = fullByColumnId.get(col.id)?.length ?? 0;
    if (total != null && total > loaded) {
      showMoreByColumnId.set(col.id, {
        // Count is the column's full hidden remainder (unfiltered) — like the
        // search, the LOB filter only narrows loaded cards. The deep-link
        // carries the active LOB so the exhaustive list view applies it too.
        count: total - loaded,
        groupId: groupOfStatus(status).id,
        lob: lobFilter ?? undefined,
      });
    }
  }

  const toggleGroup = (groupId: OpportunityGroupId) =>
    setExpanded((prev) => ({ ...prev, [groupId]: !prev[groupId] }));

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveId(id);
    snapshotRef.current = cards;
    originStatusRef.current = cards.find((c) => c.id === id)?.status ?? null;
  };

  const openCard = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    const originStatus = originStatusRef.current;
    if (!over || !originStatus) return;

    const activeCardId = String(active.id);
    const overId = String(over.id);
    if (overId === activeCardId) return; // dropped on itself

    // Destination column: `over` is either a column body or a card in it.
    const destColId = fullByColumnId.has(overId)
      ? overId
      : columnIdByCard.get(overId);
    const destColumn = columns.find((c) => c.id === destColId);
    if (!destColumn) return;

    const newStatus = resolveTargetStatus(destColumn.target, originStatus);

    // Destination cards in position order (full, not search-filtered), minus the
    // dragged card — neighbours here decide the persisted position.
    const destCards = (fullByColumnId.get(destColumn.id) ?? []).filter(
      (c) => c.id !== activeCardId,
    );

    // Insertion index: append when dropped on the column body; otherwise before
    // or after the hovered card depending on drag direction.
    let k = destCards.length;
    if (!fullByColumnId.has(overId)) {
      const overIndex = destCards.findIndex((c) => c.id === overId);
      if (overIndex !== -1) {
        const activeRect = active.rect.current.translated;
        const overRect = over.rect;
        const after =
          activeRect && overRect ? activeRect.top > overRect.top : false;
        k = after ? overIndex + 1 : overIndex;
      }
    }

    const before = k > 0 ? destCards[k - 1].position : null;
    const afterPos = k < destCards.length ? destCards[k].position : null;
    const newPosition = computePosition(before, afterPos);

    const current = cards.find((c) => c.id === activeCardId);
    if (
      current &&
      current.status === newStatus &&
      current.position === newPosition
    ) {
      return; // no change
    }

    // Delivery stages need a project. Block the move (don't apply it), and
    // either prompt to create one on the spot or explain who can. Only when the
    // card actually changes stage — a reorder within the same column (status
    // unchanged) must not trigger the prompt.
    if (
      newStatus !== originStatus &&
      requiresProject(newStatus) &&
      current &&
      !current.hasProject
    ) {
      if (canCreateProject) {
        setProjectPrompt({
          opportunityId: activeCardId,
          opportunityName: current.name,
          pendingMove: {
            id: activeCardId,
            status: newStatus,
            position: newPosition,
          },
        });
      } else {
        toast.error(
          "A delivery manager must create a project for this opportunity before it can advance.",
        );
      }
      return;
    }

    setCards((prev) =>
      prev.map((c) =>
        c.id === activeCardId
          ? { ...c, status: newStatus, position: newPosition }
          : c,
      ),
    );
    execute({ id: activeCardId, status: newStatus, position: newPosition });
  };

  // After the prompted project is created, complete the pending status move.
  const completePendingMove = () => {
    const move = projectPrompt?.pendingMove;
    setProjectPrompt(null);
    if (!move) return;
    // The project now exists, so a failed status update should revert to the
    // origin *with* hasProject true — patch the snapshot the error path restores.
    snapshotRef.current = snapshotRef.current.map((c) =>
      c.id === move.id ? { ...c, hasProject: true } : c,
    );
    setCards((prev) =>
      prev.map((c) =>
        c.id === move.id
          ? {
              ...c,
              status: move.status,
              position: move.position,
              hasProject: true,
            }
          : c,
      ),
    );
    execute(move);
  };

  const activeCard = activeId
    ? (cards.find((c) => c.id === activeId) ?? null)
    : null;

  // Prev/next neighbours for the open card, within its column's *visible* cards
  // so navigation matches what the search filter is showing. Undefined at a
  // boundary; if the selected card is filtered out (idx === -1) `navTotal` is 0
  // and the drawer hides its nav controls and x-of-y count.
  const selectedColId = selectedId ? columnIdByCard.get(selectedId) : undefined;
  const siblings = selectedColId
    ? (visibleByColumnId.get(selectedColId) ?? [])
    : [];
  const selectedIndex = siblings.findIndex((c) => c.id === selectedId);
  const prevId = selectedIndex > 0 ? siblings[selectedIndex - 1].id : null;
  const nextId =
    selectedIndex >= 0 && selectedIndex < siblings.length - 1
      ? siblings[selectedIndex + 1].id
      : null;
  // 1-based position + column size for the "x of y" indicator; 0 when the card
  // isn't in the visible list, which hides the whole nav strip.
  const navTotal = selectedIndex >= 0 ? siblings.length : 0;
  const navPosition = selectedIndex >= 0 ? selectedIndex + 1 : 0;

  const board = (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {units.map((unit) =>
        unit.kind === "expanded" ? (
          <div
            key={unit.group.id}
            className="flex shrink-0 flex-col gap-2 rounded-md border bg-muted/30 p-2"
          >
            <div className="flex items-center justify-between gap-2 px-1">
              <h4 className="text-sm font-semibold tracking-tight">
                {unit.group.label}
              </h4>
              <IconButton
                label="Collapse group"
                size="icon-sm"
                onClick={() => toggleGroup(unit.group.id)}
              >
                <IconArrowsMinimize />
              </IconButton>
            </div>
            <div className="flex gap-2">
              {unit.columns.map((col) => (
                <OpportunityBoardColumn
                  key={col.id}
                  id={col.id}
                  label={col.label}
                  cards={visibleByColumnId.get(col.id) ?? []}
                  showSubstatusBadge={col.showSubstatusBadge}
                  canEdit={canEdit}
                  onOpenCard={canEdit ? openCard : undefined}
                  showMore={showMoreByColumnId.get(col.id)}
                />
              ))}
            </div>
          </div>
        ) : unit.expandable ? (
          // A collapsed multi-status group: wrap the merged column in the same
          // bordered panel the expanded state uses, so it reads as a group that
          // opens in place — not as a plain single-status column.
          <div
            key={unit.group.id}
            className="flex shrink-0 flex-col gap-2 rounded-md border bg-muted/30 p-2"
          >
            <OpportunityBoardColumn
              id={unit.column.id}
              label={unit.column.label}
              cards={visibleByColumnId.get(unit.column.id) ?? []}
              showSubstatusBadge={unit.column.showSubstatusBadge}
              canEdit={canEdit}
              onOpenCard={canEdit ? openCard : undefined}
              showMore={showMoreByColumnId.get(unit.column.id)}
              toggle={{
                expanded: false,
                onToggle: () => toggleGroup(unit.group.id),
              }}
            />
          </div>
        ) : (
          <OpportunityBoardColumn
            key={unit.column.id}
            id={unit.column.id}
            label={unit.column.label}
            cards={visibleByColumnId.get(unit.column.id) ?? []}
            showSubstatusBadge={unit.column.showSubstatusBadge}
            canEdit={canEdit}
            onOpenCard={canEdit ? openCard : undefined}
            showMore={showMoreByColumnId.get(unit.column.id)}
          />
        ),
      )}
    </div>
  );

  if (cards.length === 0) {
    return (
      <p className="py-8 text-sm text-muted-foreground">
        No opportunities yet.
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 max-w-sm flex-1 flex-col gap-1.5">
          <FilterLabel htmlFor={searchId}>Search</FilterLabel>
          <div className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchId}
              type="search"
              placeholder="Search opportunities by name…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <SelectFilter
          label="Line of business"
          value={lob}
          options={LINE_OF_BUSINESS}
          labels={LINE_OF_BUSINESS_LABELS}
          onChange={setLob}
        />
      </div>

      {canEdit ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          {board}
          <DragOverlay>
            {activeCard ? (
              <OpportunityCardView
                card={activeCard}
                substatusLabel={
                  columnByStatus.get(activeCard.status)?.showSubstatusBadge
                    ? STATUS_LABELS[activeCard.status]
                    : null
                }
                overlay
                dragHandle={<CardDragHandle />}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        board
      )}

      {canEdit ? (
        <>
          <OpportunityDetailSheet
            opportunityId={selectedId}
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            canCreateProject={canCreateProject}
            onPrev={prevId ? () => setSelectedId(prevId) : undefined}
            onNext={nextId ? () => setSelectedId(nextId) : undefined}
            position={navPosition}
            total={navTotal}
          />
          <ConfirmDialog
            open={projectPrompt !== null}
            onOpenChange={(next) => {
              if (!next && !createProject.isPending) setProjectPrompt(null);
            }}
            title="Create a project?"
            description={
              projectPrompt
                ? `"${projectPrompt.opportunityName}" needs a project before it can move to a delivery stage. Create one now? It inherits the opportunity's name and company.`
                : undefined
            }
            confirmLabel="Create project"
            loading={createProject.isPending}
            onConfirm={() =>
              projectPrompt &&
              createProject.execute({
                opportunityId: projectPrompt.opportunityId,
              })
            }
          />
        </>
      ) : null}
    </div>
  );
}
