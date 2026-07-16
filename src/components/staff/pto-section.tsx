import { IconExternalLink } from "@tabler/icons-react";
import type { StaffPtoView } from "@/actions/staff/getStaffPto";
import { PtoList } from "@/components/staff/pto-list";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RIPPLING_TIME_OFF_URL } from "@/lib/constants";
import { PTO_TYPE_LABELS } from "@/lib/staff-enums";

/** How many past spans to show before collapsing the rest behind "Show more". */
const PAST_COLLAPSE_AFTER = 4;

export function PtoSection({ pto }: { pto: StaffPtoView }) {
  const { upcoming, past, summary } = pto;
  const isEmpty =
    upcoming.length === 0 && past.length === 0 && summary.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Time off</CardTitle>
        <CardAction>
          {/*
            A real anchor, not <Button render={<a>}>: this navigates to an
            external page, so it's a link — not a role="button". Keeping the
            faux-button semantics also gave extensions an interactive element to
            mutate pre-hydration, which broke hydration here.
          */}
          <a
            href={RIPPLING_TIME_OFF_URL}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Manage
            <IconExternalLink />
          </a>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isEmpty ? (
          <p className="text-sm text-muted-foreground">No time off recorded.</p>
        ) : (
          <>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
