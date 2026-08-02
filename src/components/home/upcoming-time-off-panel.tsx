import { EmptyState } from "@/components/empty-state";
import { PersonRow } from "@/components/home/person-row";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UpcomingLeave } from "@/lib/allocations/availability";
import { formatDateRange } from "@/lib/format/format";
import { PTO_TYPE_LABELS } from "@/lib/staff/staff-enums";

/** Rows shown before the list defers to a summary line. */
const ROW_LIMIT = 5;

/**
 * Approved leave running or starting soon.
 *
 * **Disclosure:** everyone signed in may see that a colleague is away and when —
 * that's availability. The leave *reason* is a `pto.review` capability, and
 * `getAllocationsGrid` has already nulled `type` for viewers without it. Render
 * the label only when `type` is present; never re-derive it here, and never
 * widen the read to fetch it.
 */
export function UpcomingTimeOffPanel({
  rows,
  horizonDays,
}: {
  rows: UpcomingLeave[];
  horizonDays: number;
}) {
  const shown = rows.slice(0, ROW_LIMIT);
  const remaining = rows.length - shown.length;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Upcoming time off</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {shown.length === 0 ? (
          <EmptyState>
            No time off booked in the next {horizonDays} days.
          </EmptyState>
        ) : (
          shown.map((leave) => (
            <PersonRow
              key={`${leave.staffId}-${leave.startDate}`}
              staffId={leave.staffId}
              name={leave.name}
              staffRole={null}
              lineOfBusiness={null}
              trailing={
                <span className="flex flex-col items-end">
                  <span>{formatDateRange(leave.startDate, leave.endDate)}</span>
                  <span>
                    {leave.workingDays}d
                    {leave.type ? ` · ${PTO_TYPE_LABELS[leave.type]}` : ""}
                    {leave.ongoing ? " · away now" : ""}
                  </span>
                </span>
              }
            />
          ))
        )}
        {remaining > 0 ? (
          <p className="pt-1 text-xs text-muted-foreground">
            {remaining} more in the next {horizonDays} days
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
