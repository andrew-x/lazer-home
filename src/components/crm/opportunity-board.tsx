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
import type { OpportunityStatus } from "@/actions/crm/createOpportunity.schema";
import type { OpportunityBoardCard } from "@/actions/crm/getOpportunitiesBoard";
import { updateOpportunityPosition } from "@/actions/crm/updateOpportunityPosition";
import { IconButton } from "@/components/icon-button";
import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  computePosition,
  type DropTarget,
  OPPORTUNITY_GROUPS,
  type OpportunityGroup,
  type OpportunityGroupId,
  requiresProject,
  resolveTargetStatus,
} from "@/lib/opportunity-pipeline";
import { OpportunityBoardColumn } from "./opportunity-board-column";
import { CardDragHandle, OpportunityCardView } from "./opportunity-card";
import { OpportunityDetailSheet } from "./opportunity-detail-sheet";
import { STATUS_LABELS } from "./opportunity-display";

/** A status move waiting on a project being created for the opportunity. */
type PendingMove = { id: string; status: OpportunityStatus; position: number };

type ProjectPrompt = {
  opportunityId: string;
  companyId: string;
  companyName: string;
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
  canEdit,
  canCreateProject,
}: {
  cards: OpportunityBoardCard[];
  canEdit: boolean;
  canCreateProject: boolean;
}) {
  const searchId = useId();
  const [cards, setCards] = useState(initialCards);
  const [expanded, setExpanded] = useState<
    Partial<Record<OpportunityGroupId, boolean>>
  >({});
  const [search, setSearch] = useState("");
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
  const signature = initialCards
    .map((c) => `${c.id}:${c.status}:${c.position}`)
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
  const query = search.trim().toLowerCase();
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
    if (!query || card.name.toLowerCase().includes(query)) {
      visibleByColumnId.get(colId)?.push(card);
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
    // either prompt to create one on the spot or explain who can.
    if (requiresProject(newStatus) && current && !current.hasProject) {
      if (canCreateProject) {
        setProjectPrompt({
          opportunityId: activeCardId,
          companyId: current.companyId,
          companyName: current.companyName,
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
                />
              ))}
            </div>
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
            toggle={
              unit.expandable
                ? {
                    expanded: false,
                    onToggle: () => toggleGroup(unit.group.id),
                  }
                : undefined
            }
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
      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor={searchId}>Search</Label>
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
          />
          <AddProjectDialog
            open={projectPrompt !== null}
            onOpenChange={(next) => {
              if (!next) setProjectPrompt(null);
            }}
            opportunityId={projectPrompt?.opportunityId}
            defaultCompanyId={projectPrompt?.companyId}
            defaultCompanyName={projectPrompt?.companyName}
            lockCompany
            onCreated={completePendingMove}
          />
        </>
      ) : null}
    </div>
  );
}
