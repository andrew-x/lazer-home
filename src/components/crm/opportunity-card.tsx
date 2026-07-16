"use client";

import type { DraggableAttributes } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconGripVertical } from "@tabler/icons-react";
import type { OpportunityBoardCard } from "@/actions/crm/getOpportunitiesBoard";
import { Badge } from "@/components/ui/badge";
import { SOURCE_LABELS, STATUS_LABELS } from "@/lib/opportunity";
import { cn } from "@/lib/utils";

// dnd-kit's `listeners` map; typed off `useSortable` so we don't reach into
// the package's internal path.
type DragListeners = ReturnType<typeof useSortable>["listeners"];

const HANDLE_CLASS =
  "flex shrink-0 items-center justify-center border-r bg-muted/40 px-0.5 text-muted-foreground";

/**
 * The full-height grip rail on the left edge of a card. Interactive (a real
 * `<button>` carrying the dnd-kit binders) when `attributes`/`listeners` are
 * passed; a static twin otherwise, so the drag-overlay clone matches the live
 * card. Exported so the board's `DragOverlay` can render the static variant.
 */
export function CardDragHandle({
  label,
  attributes,
  listeners,
}: {
  label?: string;
  attributes?: DraggableAttributes;
  listeners?: DragListeners;
}) {
  if (attributes || listeners) {
    return (
      <button
        type="button"
        aria-label={label}
        className={cn(
          HANDLE_CLASS,
          "touch-none cursor-grab hover:bg-muted hover:text-foreground active:cursor-grabbing",
        )}
        {...attributes}
        {...listeners}
      >
        <IconGripVertical className="size-4" />
      </button>
    );
  }
  return (
    <div className={HANDLE_CLASS} aria-hidden>
      <IconGripVertical className="size-4" />
    </div>
  );
}

/**
 * The visible card — shared by the sortable card and the drag overlay. A left
 * grip rail (`dragHandle`) sits beside the body; when `onOpen` is set the body
 * is the clickable control (a real `<button>`), otherwise a plain `<div>`. The
 * rail and the body are siblings, so dragging by the grip and clicking the body
 * never contend.
 */
export function OpportunityCardView({
  card,
  substatusLabel,
  overlay = false,
  onOpen,
  dragHandle,
}: {
  card: OpportunityBoardCard;
  /** Substatus label shown when the card sits in a collapsed group column. */
  substatusLabel: string | null;
  overlay?: boolean;
  /** When set, the body opens the detail drawer on click. */
  onOpen?: () => void;
  /** The left grip rail (a `CardDragHandle`); omitted on read-only boards. */
  dragHandle?: React.ReactNode;
}) {
  const content = (
    <>
      {substatusLabel ? (
        <Badge variant="secondary" className="self-start">
          {substatusLabel}
        </Badge>
      ) : null}
      <span className="font-medium leading-tight">{card.name}</span>
      <span className="text-xs text-muted-foreground">
        {card.companyName} · {SOURCE_LABELS[card.source]}
      </span>
      <span className="text-xs text-muted-foreground">
        {card.ownerNames.length > 0 ? card.ownerNames.join(", ") : "—"}
      </span>
    </>
  );

  const bodyClass = "flex flex-1 flex-col gap-1.5 p-3 text-left";

  return (
    <div
      className="flex overflow-hidden rounded-md border bg-card text-sm"
      // The drag overlay is a floating surface lifted above the board, so it
      // gets a real elevation cue. In-page `shadow-*` classes are neutralized by
      // globals.css (flat surfaces), so the lift is applied inline to win; live
      // cards stay flat. Mirrors the overlay shadow tokens in globals.css.
      style={
        overlay
          ? {
              boxShadow:
                "0 12px 28px -12px rgb(0 0 0 / 0.16), 0 4px 12px -6px rgb(0 0 0 / 0.1)",
            }
          : undefined
      }
    >
      {dragHandle}
      {onOpen ? (
        <button
          type="button"
          className={bodyClass}
          aria-label={`Open ${card.name}`}
          onClick={onOpen}
        >
          {content}
        </button>
      ) : (
        <div className={bodyClass}>{content}</div>
      )}
    </div>
  );
}

/**
 * A draggable card. `showSubstatusBadge` is true in collapsed group columns.
 * The body opens the detail drawer on click; dragging happens only via the
 * full-height grip rail on the left (which carries the dnd-kit listeners).
 */
export function SortableOpportunityCard({
  card,
  showSubstatusBadge,
  onOpen,
}: {
  card: OpportunityBoardCard;
  showSubstatusBadge: boolean;
  onOpen?: (id: string) => void;
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
      className={cn(isDragging && "opacity-40")}
    >
      <OpportunityCardView
        card={card}
        substatusLabel={showSubstatusBadge ? STATUS_LABELS[card.status] : null}
        onOpen={onOpen ? () => onOpen(card.id) : undefined}
        dragHandle={
          <CardDragHandle
            label={`Drag ${card.name}`}
            attributes={attributes}
            listeners={listeners}
          />
        }
      />
    </div>
  );
}
