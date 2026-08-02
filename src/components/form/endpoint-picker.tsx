"use client";

import { IconCalendar } from "@tabler/icons-react";
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

/** Compact endpoint label, e.g. "Jul 27, 2026". */
function formatCompact(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parseIsoDate(value));
}

/**
 * One end of a date range: a compact date button opening a calendar popover, with
 * no clear affordance (a range endpoint is never empty). `min`/`max` bound the
 * selectable days so the two ends of a range can't cross.
 *
 * Shared by the allocations planner's `PlannerRange` — which adds granularity-aware
 * prev/next chevrons around a pair of these — and the utilization report's range
 * control, which needs the same pair without any notion of granularity.
 *
 * Values are wall-clock `"YYYY-MM-DD"` strings in and out, never `Date`, matching
 * the `date()` columns these ranges query (see `.claude/rules/database.md`).
 */
export function EndpointPicker({
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
