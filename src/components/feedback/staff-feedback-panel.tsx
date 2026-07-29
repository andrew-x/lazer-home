"use client";

import { IconExternalLink } from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";
import type { StaffFeedbackView } from "@/actions/feedback/getFeedbackAboutStaff";
import { EmptyState } from "@/components/empty-state";
import { FeedbackAboutMe } from "@/components/feedback/feedback-about-me";
import {
  FeedbackDetailDialog,
  type FeedbackDialogItem,
} from "@/components/feedback/feedback-detail-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTimestamp } from "@/lib/format/format";
import { FEEDBACK_RATING_LABELS } from "@/lib/performance/feedback-rating";

/**
 * The **Peer feedback** tab on a staff profile: feedback this person has
 * received, in whichever of the two tiers the viewer is entitled to
 * (`getFeedbackAboutStaff` decides — this component only renders what it was
 * given, and says out loud which tier that is).
 *
 * Rendered on `/staff/[id]`, `/profile`, and inside the compensation-plan profile
 * drawer, so it takes plain data and holds no reads of its own.
 */
export function StaffFeedbackPanel({
  view,
  staffName,
}: {
  view: StaffFeedbackView;
  /** Who the feedback is about — the shared detail dialog titles itself with it. */
  staffName: string;
}) {
  const [selected, setSelected] = useState<FeedbackDialogItem | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {view.tier === "recipient"
            ? "You can see who left feedback and any message they shared with you. The rest of each review stays private."
            : `Feedback ${staffName} has received. As a reviewer you can see each item in full — they can't.`}
        </p>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/feedback" />}
        >
          Peer Feedback
          <IconExternalLink />
        </Button>
      </div>

      {view.tier === "recipient" ? (
        <FeedbackAboutMe rows={view.rows} />
      ) : view.rows.length === 0 ? (
        <EmptyState bordered>
          {staffName} hasn't received any feedback yet.
        </EmptyState>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Author</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Context</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => {
                        // The dialog titles itself with the recipient, which this
                        // per-person read doesn't repeat on every row.
                        setSelected({ ...row, recipientName: staffName });
                        setOpen(true);
                      }}
                    >
                      {row.giverName}
                    </button>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {FEEDBACK_RATING_LABELS[row.rating]}
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
        </div>
      )}

      <FeedbackDetailDialog
        item={selected}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}
