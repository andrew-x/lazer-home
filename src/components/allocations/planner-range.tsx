"use client";

import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import { useState } from "react";
import type { Matcher } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatIsoDate, parseIsoDate } from "@/lib/format/format";
import { addWeeks } from "@/lib/timesheets/timesheet-week";

/** Compact endpoint label, e.g. "Jul 27, 2026". */
function formatCompact(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parseIsoDate(value));
}

/**
 * A single compact date button (calendar popover, no clear affordance). `min`/
 * `max` bound the selectable days so the two endpoints can't cross.
 */
function EndpointPicker({
  value,
  onChange,
  min,
  max,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const disabled: Matcher | undefined =
    min && max
      ? { before: parseIsoDate(min), after: parseIsoDate(max) }
      : min
        ? { before: parseIsoDate(min) }
        : max
          ? { after: parseIsoDate(max) }
          : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={ariaLabel}
            className="justify-start gap-2 font-normal"
          >
            <IconCalendar className="size-4 shrink-0" />
            <span>{formatCompact(value)}</span>
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          defaultMonth={parseIsoDate(value)}
          selected={parseIsoDate(value)}
          disabled={disabled}
          onSelect={(date) => {
            if (!date) return;
            onChange(formatIsoDate(date));
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The planner's date-range control: two distinct date pickers forming the range,
 * flanked by prev/next buttons that scroll the whole window one week at a time.
 * Neither endpoint can be cleared (an empty planner window makes no sense) and
 * the two can't cross.
 */
export function PlannerRange({
  start,
  end,
  onChange,
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}) {
  const shift = (weeks: number) =>
    onChange(addWeeks(start, weeks), addWeeks(end, weeks));

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Previous week"
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
        aria-label="Next week"
        onClick={() => shift(1)}
      >
        <IconChevronRight className="size-4" />
      </Button>
    </div>
  );
}
