"use client";

import { useState } from "react";
import type { FeedbackIGaveRow } from "@/actions/feedback/getFeedbackIGave";
import { EmptyState } from "@/components/empty-state";
import { FeedbackDetailDialog } from "@/components/feedback/feedback-detail-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTimestamp } from "@/lib/format/format";

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
    return <EmptyState>You haven't given any feedback yet.</EmptyState>;
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
                  className="text-left hover:underline"
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

      <FeedbackDetailDialog
        item={selected}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
