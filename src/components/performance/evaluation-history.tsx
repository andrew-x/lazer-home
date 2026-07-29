import type { EvaluationHistoryEntry } from "@/actions/performance/getStaffEvaluationHistory";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format/format";
import { RUBRIC_LABELS } from "@/lib/performance/rating-rubric";
import { formatLevel } from "@/lib/staff/staff-rating";

/**
 * A person's rating history, newest first — one entry per dated evaluation, with
 * its overall level and any per-category subratings it carried.
 *
 * Purely presentational, in the same left-border timeline as `HistoryTimeline` so
 * the two history surfaces read alike. The caller is responsible for the
 * `ratings.view` gate (see `getStaffEvaluationHistory`, which returns null rather
 * than an empty list when the viewer isn't permitted).
 */
export function EvaluationHistory({
  entries,
}: {
  entries: EvaluationHistoryEntry[];
}) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No evaluations recorded yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {entries.map((entry) => {
        // Labelled from the flattened rubric rather than the person's current
        // role: a stored key can predate a role change, and a raw key is a better
        // fallback than dropping the score.
        const subratings = Object.entries(entry.subratings ?? {});

        return (
          <div key={entry.id} className="flex flex-col gap-2 border-l-2 pl-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {formatDate(entry.effectiveDate)}
              </span>
              <Badge variant="secondary">{formatLevel(entry.level)}</Badge>
              {entry.evaluatedByName ? (
                <span className="text-xs text-muted-foreground">
                  by {entry.evaluatedByName}
                </span>
              ) : null}
            </div>

            {subratings.length > 0 ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {subratings.map(([key, level]) => (
                  <span key={key} className="text-xs text-muted-foreground">
                    {RUBRIC_LABELS[key] ?? key}{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      L{level}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
