import type { FeedbackAboutMeRow } from "@/actions/feedback/getFeedbackAboutMe";
import { EmptyState } from "@/components/empty-state";
import { formatTimestamp } from "@/lib/format";

/**
 * The recipient's view: feedback left about you. Deliberately shows only the
 * giver's name, the date, and the message they chose to share — the rating and
 * the rest of the feedback are private (never fetched for this view).
 */
export function FeedbackAboutMe({ rows }: { rows: FeedbackAboutMeRow[] }) {
  if (rows.length === 0) {
    return <EmptyState bordered>No feedback about you yet.</EmptyState>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-md border p-4">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm font-medium">{row.giverName}</span>
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(row.createdAt)}
            </span>
          </div>
          {row.messageToRecipient ? (
            <p className="mt-2 text-sm whitespace-pre-wrap">
              {row.messageToRecipient}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground italic">
              No message was left for you.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
