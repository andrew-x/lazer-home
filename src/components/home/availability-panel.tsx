import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PersonRow } from "@/components/home/person-row";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type {
  AvailabilityPerson,
  AvailabilityWeek,
} from "@/lib/allocations/availability";
import { formatShortDate, parseIsoDate } from "@/lib/format/format";

/** How many names each sublist shows before deferring to the planner. */
const NAME_LIMIT = 4;

/**
 * Who has capacity, now and over the next four weeks.
 *
 * The bench list and the forecast are **one card on purpose**: "unallocated" is
 * bucket 0 of "free now / +1 / +2 / +3 / +4", and shipping them separately would
 * print the same names twice, inches apart.
 *
 * The counts include a person in every week they're free — that's what "who's
 * free in three weeks" means. The name lists key each person to the *first* week
 * they free up, so nobody is listed twice and the card stays scannable. Spare
 * capacity is also given in FTE, because five half-free people and five
 * fully-free people are very different weeks.
 *
 * Everything here is already public via `/allocations`; no new disclosure.
 */
export function AvailabilityPanel({
  weeks,
  people,
  hasStaff,
}: {
  weeks: AvailabilityWeek[];
  people: AvailabilityPerson[];
  hasStaff: boolean;
}) {
  const firstWeek = weeks[0]?.weekStart;
  const freeNow = people.filter((person) => person.freeFrom === firstWeek);
  const freeingUp = people.filter(
    (person) => person.freeFrom !== null && person.freeFrom !== firstWeek,
  );
  const nextWeek = weeks[1];

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Availability</CardTitle>
        <CardAction>
          <Link
            href="/allocations"
            className="text-sm text-primary hover:underline"
          >
            Open the planner
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!hasStaff ? (
          <EmptyState>No active billable staff yet.</EmptyState>
        ) : (
          <>
            <div>
              <div className="grid grid-cols-5 gap-1">
                {weeks.map((week, index) => (
                  <div key={week.weekStart} className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {index === 0 ? "Now" : `+${index} wk`}
                    </span>
                    <span className="text-xl font-semibold tabular-nums">
                      {week.availableCount}
                    </span>
                  </div>
                ))}
              </div>
              {nextWeek ? (
                <p className="pt-2 text-xs text-muted-foreground">
                  {nextWeek.freeFte.toFixed(1)} FTE free next week. Mon–Fri;
                  public holidays counted only when recorded as leave.
                </p>
              ) : null}
            </div>

            <Separator />

            <div className="flex flex-col gap-3">
              <AvailabilityList
                label="Free now"
                people={freeNow}
                empty="Everyone billable is allocated this week."
                showFreeFrom={false}
              />
              <AvailabilityList
                label="Freeing up"
                people={freeingUp}
                empty="No one frees up in the next four weeks."
                showFreeFrom
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AvailabilityList({
  label,
  people,
  empty,
  showFreeFrom,
}: {
  label: string;
  people: AvailabilityPerson[];
  empty: string;
  showFreeFrom: boolean;
}) {
  const shown = people.slice(0, NAME_LIMIT);
  const remaining = people.length - shown.length;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        shown.map((person) => (
          <PersonRow
            key={person.staffId}
            staffId={person.staffId}
            name={person.name}
            staffRole={person.role}
            lineOfBusiness={person.lineOfBusiness}
            trailing={
              <span className="flex items-center gap-1.5">
                {person.tentativeOnly ? (
                  <Badge variant="secondary" className="font-normal">
                    Tentative
                  </Badge>
                ) : null}
                {showFreeFrom && person.freeFrom
                  ? formatShortDate(parseIsoDate(person.freeFrom))
                  : null}
              </span>
            }
          />
        ))
      )}
      {remaining > 0 ? (
        <p className="text-xs text-muted-foreground">
          {remaining} more ·{" "}
          <Link href="/allocations" className="text-primary hover:underline">
            open the planner
          </Link>
        </p>
      ) : null}
    </div>
  );
}
