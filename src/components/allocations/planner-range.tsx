"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { EndpointPicker } from "@/components/form/endpoint-picker";
import { Button } from "@/components/ui/button";
import type { Granularity } from "@/lib/allocations/allocations-grid";
import { addDays, addMonths, addWeeks } from "@/lib/timesheets/timesheet-week";

/** Shift a date by `n` buckets of the active granularity (may be negative). */
function shiftBy(date: string, granularity: Granularity, n: number): string {
  switch (granularity) {
    case "day":
      return addDays(date, n);
    case "week":
      return addWeeks(date, n);
    case "month":
      return addMonths(date, n);
  }
}

/**
 * The planner's date-range control: two distinct date pickers forming the range,
 * flanked by prev/next buttons that scroll the whole window one bucket (day,
 * week, or month) at a time. Neither endpoint can be cleared (an empty planner
 * window makes no sense) and the two can't cross.
 */
export function PlannerRange({
  start,
  end,
  granularity,
  onChange,
}: {
  start: string;
  end: string;
  granularity: Granularity;
  onChange: (start: string, end: string) => void;
}) {
  const shift = (buckets: number) =>
    onChange(
      shiftBy(start, granularity, buckets),
      shiftBy(end, granularity, buckets),
    );

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Previous ${granularity}`}
        onClick={() => shift(-1)}
      >
        <IconChevronLeft className="size-4" />
      </Button>

      <EndpointPicker
        value={start}
        onChange={(next) => onChange(next, end)}
        max={end}
        ariaLabel="Range start"
      />
      <span className="text-sm text-muted-foreground">–</span>
      <EndpointPicker
        value={end}
        onChange={(next) => onChange(start, next)}
        min={start}
        ariaLabel="Range end"
      />

      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Next ${granularity}`}
        onClick={() => shift(1)}
      >
        <IconChevronRight className="size-4" />
      </Button>
    </div>
  );
}
