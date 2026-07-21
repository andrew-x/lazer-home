import { EmptyCell } from "@/components/empty-cell";
import { formatShortDate } from "@/lib/format";

/**
 * The "next steps" cell shared by the contacts list and the company detail's
 * contacts table: the next-step note (clamped to two lines) with its timestamp
 * beneath in muted small text, or an {@link EmptyCell} when there's no next step.
 */
export function ContactNextStepCell({
  nextStep,
  nextStepAt,
}: {
  nextStep: string | null;
  nextStepAt: number | null;
}) {
  if (!nextStep) {
    return <EmptyCell />;
  }

  return (
    <span className="flex flex-col gap-0.5">
      <span className="line-clamp-2">{nextStep}</span>
      {nextStepAt ? (
        <span className="text-xs text-muted-foreground">
          {formatShortDate(new Date(nextStepAt))}
        </span>
      ) : null}
    </span>
  );
}
