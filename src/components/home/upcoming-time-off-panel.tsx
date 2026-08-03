import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PersonRow } from "@/components/home/person-row";
import { ScrollList } from "@/components/home/scroll-list";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  LeaveProject,
  UpcomingLeave,
} from "@/lib/allocations/availability";
import { formatDateRange } from "@/lib/format/format";
import { PTO_TYPE_LABELS } from "@/lib/staff/staff-enums";

/**
 * Approved leave running or starting soon, and what each absence leaves short.
 *
 * The **project** sub-line is the point: "Ada is away next week" is only half a
 * fact, and the half that needs acting on is which engagement goes uncovered. It
 * links straight to the project, and ellipsizes rather than wrapping so the list
 * stays one line per person.
 *
 * **Disclosure:** everyone signed in may see that a colleague is away and when —
 * that's availability. The leave *reason* is a `pto.review` capability, and
 * `getAllocationsGrid` has already nulled `type` for viewers without it. Render
 * the label only when `type` is present; never re-derive it here, and never
 * widen the read to fetch it. Project names carry no such gate — they're already
 * public via `/allocations`.
 *
 * The list scrolls rather than truncating (see {@link ScrollList}), so the header
 * carries the count the old "N more" line used to — how much leave is coming is
 * worth knowing before you start scrolling.
 */
export function UpcomingTimeOffPanel({
  rows,
  horizonDays,
}: {
  rows: UpcomingLeave[];
  horizonDays: number;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Upcoming time off</CardTitle>
        {rows.length > 0 ? (
          <CardAction className="text-xs text-muted-foreground">
            {rows.length} in the next {horizonDays} days
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState>
            No time off booked in the next {horizonDays} days.
          </EmptyState>
        ) : (
          <ScrollList>
            {rows.map((leave) => (
              <PersonRow
                key={`${leave.staffId}-${leave.startDate}`}
                staffId={leave.staffId}
                name={leave.name}
                staffRole={null}
                lineOfBusiness={null}
                subtitle={<LeaveProjects projects={leave.projects} />}
                trailing={
                  <span className="flex flex-col items-end">
                    <span>
                      {formatDateRange(leave.startDate, leave.endDate)}
                    </span>
                    <span>
                      {leave.workingDays}d
                      {leave.type ? ` · ${PTO_TYPE_LABELS[leave.type]}` : ""}
                      {leave.ongoing ? " · away now" : ""}
                    </span>
                  </span>
                }
              />
            ))}
          </ScrollList>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The engagement(s) an absence leaves short. Names the heaviest one and counts the
 * rest, rather than listing them all — the row is one line, and the first project
 * is the one someone has to go and cover.
 *
 * Renders nothing when the person holds no role over the span. That's a real state
 * (someone on the bench taking leave), and a "—" would imply missing data.
 */
function LeaveProjects({ projects }: { projects: LeaveProject[] }) {
  const [first, ...rest] = projects;
  if (!first) return null;

  return (
    <span className="flex min-w-0 items-center gap-1">
      <Link
        href={`/projects/${first.projectId}`}
        className="truncate hover:underline"
      >
        {first.projectName}
      </Link>
      {rest.length > 0 ? (
        <span className="shrink-0">+{rest.length}</span>
      ) : null}
    </span>
  );
}
