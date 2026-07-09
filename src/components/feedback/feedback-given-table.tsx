"use client";

import { useState } from "react";
import type { FeedbackIGaveRow } from "@/actions/feedback/getFeedbackIGave";
import { FeedbackDetailFields } from "@/components/feedback/feedback-detail-fields";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FEEDBACK_RATING_LABELS } from "@/lib/feedback-rating";
import { formatTimestamp } from "@/lib/format";

/**
 * The feedback the current user has authored. Each row opens the full item in a
 * dialog (the content is already loaded — it's the caller's own feedback).
 */
export function FeedbackGivenTable({ rows }: { rows: FeedbackIGaveRow[] }) {
  // `open` drives the dialog; `selected` holds the content. They're separate so
  // the content stays mounted through the close animation instead of vanishing
  // the instant the dialog starts closing (which reads as a flicker).
  const [selected, setSelected] = useState<FeedbackIGaveRow | null>(null);
  const [open, setOpen] = useState(false);

  if (rows.length === 0) {
    return (
      <p className="px-2 py-8 text-center text-sm text-muted-foreground">
        You haven't given any feedback yet.
      </p>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Recipient</TableHead>
            <TableHead>Context</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">
                <button
                  type="button"
                  className="cursor-pointer text-left hover:underline"
                  onClick={() => {
                    setSelected(row);
                    setOpen(true);
                  }}
                >
                  {row.recipientName}
                </button>
              </TableCell>
              <TableCell className="max-w-md text-muted-foreground">
                <span className="line-clamp-2">{row.context}</span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatTimestamp(row.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>Feedback for {selected.recipientName}</DialogTitle>
                <DialogDescription>
                  {FEEDBACK_RATING_LABELS[selected.rating]} ·{" "}
                  {formatTimestamp(selected.createdAt)}
                </DialogDescription>
              </DialogHeader>
              <FeedbackDetailFields detail={selected} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
