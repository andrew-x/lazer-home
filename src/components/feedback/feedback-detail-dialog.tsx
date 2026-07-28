"use client";

import {
  FeedbackDetailFields,
  type FeedbackDetailFieldValues,
} from "@/components/feedback/feedback-detail-fields";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatTimestamp } from "@/lib/format/format";
import {
  FEEDBACK_RATING_LABELS,
  type FeedbackRating,
} from "@/lib/performance/feedback-rating";

/** The fields this dialog needs — satisfied by any full-content feedback row. */
export type FeedbackDialogItem = FeedbackDetailFieldValues & {
  recipientName: string;
  rating: FeedbackRating;
  createdAt: Date;
};

/**
 * The full content of one feedback item in a dialog, shared by the feedback
 * tables on `/feedback`. Callers keep `item` and `open` in *separate* state so
 * the content stays mounted through the close animation instead of vanishing the
 * instant the dialog starts closing (which reads as a flicker) — hence `item`
 * staying non-null after `open` goes false.
 */
export function FeedbackDetailDialog({
  item,
  open,
  onOpenChange,
}: {
  item: FeedbackDialogItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        {item ? (
          <>
            <DialogHeader>
              <DialogTitle>Feedback for {item.recipientName}</DialogTitle>
              <DialogDescription>
                {FEEDBACK_RATING_LABELS[item.rating]} ·{" "}
                {formatTimestamp(item.createdAt)}
              </DialogDescription>
            </DialogHeader>
            <FeedbackDetailFields detail={item} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
