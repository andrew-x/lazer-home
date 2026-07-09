"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { OpportunityBoardCard } from "@/actions/crm/getOpportunitiesBoard";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SOURCE_LABELS, STATUS_LABELS } from "./opportunity-display";

/** The visible card markup — shared by the sortable card and the drag overlay. */
export function OpportunityCardView({
  card,
  substatusLabel,
  dragging = false,
  overlay = false,
}: {
  card: OpportunityBoardCard;
  /** Substatus label shown when the card sits in a collapsed group column. */
  substatusLabel: string | null;
  dragging?: boolean;
  overlay?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border bg-card p-3 text-sm",
        overlay && "shadow-md",
        dragging && !overlay && "opacity-40",
      )}
    >
      {substatusLabel ? (
        <Badge variant="secondary" className="self-start">
          {substatusLabel}
        </Badge>
      ) : null}
      <p className="font-medium leading-tight">{card.name}</p>
      <p className="text-xs text-muted-foreground">
        {card.companyName} · {SOURCE_LABELS[card.source]}
      </p>
      <p className="text-xs text-muted-foreground">
        {card.ownerNames.length > 0 ? card.ownerNames.join(", ") : "—"}
      </p>
    </div>
  );
}

/** A draggable card. `showSubstatusBadge` is true in collapsed group columns. */
export function SortableOpportunityCard({
  card,
  showSubstatusBadge,
}: {
  card: OpportunityBoardCard;
  showSubstatusBadge: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="touch-none cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <OpportunityCardView
        card={card}
        substatusLabel={showSubstatusBadge ? STATUS_LABELS[card.status] : null}
        dragging={isDragging}
      />
    </div>
  );
}
