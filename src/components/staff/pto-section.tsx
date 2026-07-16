import type { StaffPtoView } from "@/actions/staff/getStaffPto";
import { PtoList } from "@/components/staff/pto-list";
import { Separator } from "@/components/ui/separator";
import { PTO_TYPE_LABELS } from "@/lib/staff-enums";

/** How many past spans to show before collapsing the rest behind "Show more". */
const PAST_COLLAPSE_AFTER = 4;

/**
 * The time-off content — this-year summary plus upcoming/past spans. Rendered
 * inside the profile's "Time off" tab; the heading and external "Manage" link
 * live in the tab wrapper (see `profile-view.tsx`).
 */
export function PtoContent({ pto }: { pto: StaffPtoView }) {
  const { upcoming, past, summary } = pto;
  const isEmpty =
    upcoming.length === 0 && past.length === 0 && summary.length === 0;

  if (isEmpty) {
    return (
      <p className="text-sm text-muted-foreground">No time off recorded.</p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {summary.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            This year
          </h3>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {summary.map((entry) => (
              <div key={entry.type} className="flex flex-col">
                <span className="text-lg font-semibold tabular-nums">
                  {entry.workingDays}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    days
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {PTO_TYPE_LABELS[entry.type]}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {summary.length > 0 && (upcoming.length > 0 || past.length > 0) ? (
        <Separator />
      ) : null}

      {upcoming.length > 0 ? (
        <PtoList title="Upcoming" spans={upcoming} />
      ) : null}
      {past.length > 0 ? (
        <PtoList
          title="Past"
          spans={past}
          collapseAfter={PAST_COLLAPSE_AFTER}
        />
      ) : null}
    </div>
  );
}
