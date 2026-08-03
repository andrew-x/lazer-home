"use client";

import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { ALL, SegmentedFilter } from "@/components/form/filters";
import { PersonRow } from "@/components/home/person-row";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AVAILABLE_THRESHOLD_PERCENT } from "@/lib/allocations/availability";
import { cn } from "@/lib/core/utils";
import { formatShortDate, parseIsoDate } from "@/lib/format/format";
import type { EmploymentFilter, OrgPerson } from "@/lib/home/org-status";
import {
  buildAvailabilityTabs,
  filterByEmploymentType,
} from "@/lib/home/org-status";
import {
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
} from "@/lib/staff/staff-enums";

/** Names shown per week before the list defers to the planner. */
const NAME_LIMIT = 8;

/**
 * Who has capacity: the bench now, then who frees up in each of the next four weeks.
 *
 * **The tabs are deltas, not running totals.** "Now" is the bench — everyone idle
 * today. Every later tab lists only the people who *become* free that week. A
 * cumulative version re-listed the long-term bench in all five tabs, which buried
 * the two people whose project actually ends in week +3 — the only names that tab
 * exists to surface. See {@link buildAvailabilityTabs} for the transition rule.
 *
 * Because of that, the tab numbers deliberately don't sum to "people with capacity",
 * and only the first shows total availability. The caption carries spare FTE for the
 * selected week so the capacity view isn't lost.
 *
 * The employment filter is here because "who can I put on this" is a different
 * question for salaried and hourly staff. Both controls re-derive the tabs over the
 * filtered population — reusing the server's unfiltered numbers would print the whole
 * company's availability above a filtered list of names.
 *
 * Everything here is already public via `/allocations`; no new disclosure.
 */
export function AvailabilityPanel({
  people,
  weekStarts,
  weekIndex,
  onWeekIndexChange,
  employmentType,
  onEmploymentTypeChange,
}: {
  /** Already narrowed by line of business by the section. */
  people: OrgPerson[];
  weekStarts: string[];
  weekIndex: number;
  onWeekIndexChange: (index: number) => void;
  employmentType: EmploymentFilter;
  onEmploymentTypeChange: (value: EmploymentFilter) => void;
}) {
  const filtered = filterByEmploymentType(people, employmentType);
  const tabs = buildAvailabilityTabs(filtered, weekStarts);
  const selected = tabs[weekIndex];

  const listed = selected?.people ?? [];
  const shown = listed.slice(0, NAME_LIMIT);
  const remaining = listed.length - shown.length;
  const onBench = weekIndex === 0;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Availability</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {people.length === 0 ? (
          <EmptyState>No active billable staff here.</EmptyState>
        ) : (
          <>
            <SegmentedFilter
              label="Type"
              value={employmentType ?? ALL}
              options={EMPLOYMENT_TYPES}
              labels={EMPLOYMENT_TYPE_LABELS}
              onChange={(value) =>
                onEmploymentTypeChange(
                  value === ALL ? null : (value as EmploymentFilter),
                )
              }
            />

            {/* `h-auto` on both list and trigger: the primitive is sized for a
                single line of text (`h-8`), and each tab here stacks a caption over
                its count. */}
            <Tabs
              value={String(weekIndex)}
              onValueChange={(value) => onWeekIndexChange(Number(value))}
            >
              <TabsList className="h-auto w-full group-data-horizontal/tabs:h-auto">
                {tabs.map((tab, index) => (
                  <TabsTrigger
                    key={tab.weekStart}
                    value={String(index)}
                    className="h-auto flex-1 flex-col gap-0 py-1.5"
                  >
                    <span className="text-[11px] font-medium uppercase tracking-wider">
                      {index === 0 ? "Bench" : `+${index} wk`}
                    </span>
                    <span
                      className={cn(
                        "text-lg font-semibold tabular-nums",
                        tab.people.length === 0 && "opacity-50",
                      )}
                    >
                      {tab.people.length}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {selected ? (
              <p className="text-xs text-muted-foreground">
                {onBench
                  ? "On the bench now"
                  : `Freeing up in the week of ${formatShortDate(parseIsoDate(selected.weekStart))}`}
                {" · "}
                {selected.freeFte.toFixed(1)} FTE spare that week
                {selected.tentativeCount > 0
                  ? ` · ${selected.tentativeCount} pencilled in`
                  : ""}
                . At least {AVAILABLE_THRESHOLD_PERCENT}% of the week free
                counts as available. Mon–Fri; public holidays counted only when
                recorded as leave.
              </p>
            ) : null}

            <Separator />

            <div className="flex flex-col gap-1">
              {shown.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {filtered.length === 0
                    ? "Nobody matches this filter."
                    : onBench
                      ? "Nobody is on the bench."
                      : "Nobody new frees up this week."}
                </p>
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
                        {person.weeks[weekIndex]?.freePercent ?? 0}% free
                      </span>
                    }
                  />
                ))
              )}
              {remaining > 0 ? (
                <p className="pt-1 text-xs text-muted-foreground">
                  {remaining} more ·{" "}
                  <Link
                    href="/allocations"
                    className="text-primary hover:underline"
                  >
                    open the planner
                  </Link>
                </p>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
