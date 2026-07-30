import type { ReactNode } from "react";
import type { SelfEvaluationRow } from "@/actions/performance/getStaffSelfEvaluations";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/format/format";
import { FEEDBACK_RATING_LABELS } from "@/lib/performance/feedback-rating";
import {
  SELF_EVALUATION_QUESTION_COUNT,
  SELF_EVALUATION_QUESTION_SET_VERSION,
} from "@/lib/performance/self-evaluation";

/**
 * One saved self-evaluation, read-only.
 *
 * !! THIS FILE MUST NOT IMPORT `SELF_EVALUATION_QUESTIONS` !!
 *
 * Every section heading and prompt is rendered **off the record**, from the snapshot
 * taken when it was written. That is the entire reason the snapshot exists: a record
 * whose question was reworded still shows the wording the person answered, a retired
 * question still shows at all, and a newly added one doesn't appear as a phantom
 * blank. Reaching for the current question set here — even to "fill in" a missing
 * prompt — would silently start misattributing words to people.
 *
 * The rating shown is the person's OWN self-assessment. It is not a `staffRating`
 * level, and no manager-assigned level may ever be rendered beside it (ADR 0032).
 */
export function SelfEvaluationRecord({
  evaluation,
  actions,
}: {
  evaluation: SelfEvaluationRow;
  /** Edit / delete buttons, supplied by the panel when this reader may manage it. */
  actions?: ReactNode;
}) {
  const stale =
    evaluation.questionSetVersion !== SELF_EVALUATION_QUESTION_SET_VERSION;

  const meta = [
    // Only the current set has a denominator we can honestly state — an older
    // record was written against a question set we no longer know the size of.
    stale
      ? `${evaluation.answers.length} answered`
      : `${evaluation.answers.length} of ${SELF_EVALUATION_QUESTION_COUNT} answered`,
    evaluation.updatedAt > evaluation.createdAt ? "edited" : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              Submitted {formatTimestamp(evaluation.createdAt)}
            </span>
            <Badge variant="secondary">
              {FEEDBACK_RATING_LABELS[evaluation.selfRating]}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {meta.join(" · ")}
          </span>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        ) : null}
      </div>

      {stale ? (
        <p className="text-xs text-muted-foreground">
          Answered against an earlier set of questions, and shown as it was
          written.
        </p>
      ) : null}

      {evaluation.answers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No written answers — just the self-rating above.
        </p>
      ) : (
        <dl className="flex flex-col gap-4">
          {evaluation.answers.map((entry) => (
            <div key={entry.questionId} className="flex flex-col gap-1">
              <dt className="flex flex-col gap-0.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {entry.section}
                </span>
                <span className="text-sm font-medium">{entry.prompt}</span>
              </dt>
              {/* No clamping: a truncated self-assessment is a misleading one. */}
              <dd className="text-sm whitespace-pre-wrap">{entry.answer}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
