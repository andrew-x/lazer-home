import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import Link from "next/link";
import type { UnsubmittedWeekAlert } from "@/lib/timesheets/timesheet-alerts";
import { formatWeekRange } from "@/lib/timesheets/timesheet-week";

type Props = {
  alerts: UnsubmittedWeekAlert[];
};

function alertText(alert: UnsubmittedWeekAlert): string {
  return alert.tone === "overdue"
    ? "Last week's timesheet isn't submitted. You can only edit the last two weeks, so submit it before it drops out of range."
    : "This week's timesheet isn't submitted yet — it's due by the end of the week.";
}

/**
 * The submission nudge at the top of the timesheets pages: the weeks in the
 * ±1-week edit window that still need submitting (see `timesheet-alerts.ts` for
 * when each one appears). Renders nothing when everything is submitted.
 *
 * An overdue week makes the whole banner destructive — it's about to fall out of
 * the editable range. A current-week reminder alone stays neutral: the week is
 * still in progress, so it's information, not a problem. (There's no `Alert`
 * primitive in this app; this is the hand-rolled banner recipe the weekly grid
 * uses — see .claude/rules/ui.md.)
 */
export function UnsubmittedWeeksBanner({ alerts }: Props) {
  if (alerts.length === 0) return null;

  const overdue = alerts.some((a) => a.tone === "overdue");
  const Icon = overdue ? IconAlertTriangle : IconInfoCircle;

  return (
    <div
      className={
        overdue
          ? "flex w-full items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          : "flex w-full items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
      }
    >
      <Icon
        className={
          overdue
            ? "mt-0.5 size-4 shrink-0"
            : "mt-0.5 size-4 shrink-0 text-muted-foreground"
        }
      />
      <ul className="flex flex-col gap-1">
        {alerts.map((alert) => (
          <li key={alert.weekStartDate}>
            {alertText(alert)}{" "}
            <Link
              href={`/timesheets/${alert.weekStartDate}`}
              className="font-medium underline underline-offset-4"
            >
              Open {formatWeekRange(alert.weekStartDate)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
