"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { IconArrowsMaximize, IconArrowsMinimize } from "@tabler/icons-react";
import type { OpportunityBoardCard } from "@/actions/crm/getOpportunitiesBoard";
import { IconButton } from "@/components/icon-button";
import { cn } from "@/lib/utils";
import {
  OpportunityCardView,
  SortableOpportunityCard,
} from "./opportunity-card";
import { STATUS_LABELS } from "./opportunity-display";

export type ColumnToggle = { expanded: boolean; onToggle: () => void };

/**
 * One kanban column — a single status, or a collapsed multi-status group. Its
 * card list is a droppable target (so empty columns still accept drops) and,
 * when editable, a sortable context for reordering.
 */
export function OpportunityBoardColumn({
  id,
  label,
  cards,
  showSubstatusBadge,
  canEdit,
  toggle,
  onOpenCard,
}: {
  id: string;
  label: string;
  cards: OpportunityBoardCard[];
  showSubstatusBadge: boolean;
  canEdit: boolean;
  toggle?: ColumnToggle;
  onOpenCard?: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  const body = (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-24 flex-1 flex-col gap-2 rounded-md p-1 transition-colors",
        isOver && "bg-muted/60",
      )}
    >
      {cards.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground">
          Empty
        </p>
      ) : canEdit ? (
        cards.map((card) => (
          <SortableOpportunityCard
            key={card.id}
            card={card}
            showSubstatusBadge={showSubstatusBadge}
            onOpen={onOpenCard}
          />
        ))
      ) : (
        cards.map((card) => (
          <OpportunityCardView
            key={card.id}
            card={card}
            substatusLabel={
              showSubstatusBadge ? STATUS_LABELS[card.status] : null
            }
          />
        ))
      )}
    </div>
  );

  return (
    <div className="flex w-72 shrink-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold tracking-tight">{label}</h4>
          <span className="text-xs text-muted-foreground">{cards.length}</span>
        </div>
        {toggle ? (
          <IconButton
            label={toggle.expanded ? "Collapse group" : "Expand group"}
            size="icon-sm"
            onClick={toggle.onToggle}
          >
            {toggle.expanded ? <IconArrowsMinimize /> : <IconArrowsMaximize />}
          </IconButton>
        ) : null}
      </div>
      {canEdit ? (
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {body}
        </SortableContext>
      ) : (
        body
      )}
    </div>
  );
}
