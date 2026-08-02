"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { usePathname, useRouter } from "next/navigation";
import { EndpointPicker } from "@/components/form/endpoint-picker";
import { FilterLabel, SelectFilter } from "@/components/form/filters";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { addDays } from "@/lib/timesheets/timesheet-week";
import type { UtilizationRange } from "@/lib/utilization/utilization-report";

/** Whole-day index since the epoch, in UTC so DST can't shift the difference. */
function dayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/**
 * The report's control bar. The **date range lives in the URL** — it bounds the
 * server query, and a report worth reading is worth linking to — while the
 * line-of-business filter and the forecast toggle are in-memory client state,
 * since neither changes what has to be fetched.
 */
export function UtilizationFilters({
  range,
  lineOfBusinessOptions,
  lineOfBusiness,
  onLineOfBusinessChange,
  includeTentative,
  onIncludeTentativeChange,
}: {
  range: UtilizationRange;
  lineOfBusinessOptions: string[];
  lineOfBusiness: string;
  onLineOfBusinessChange: (value: string) => void;
  includeTentative: boolean;
  onIncludeTentativeChange: (value: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const setRange = (start: string, end: string) => {
    const params = new URLSearchParams({ start, end });
    router.replace(`${pathname}?${params.toString()}`);
  };

  // Shift by the length of the current window, so "previous" on a calendar month
  // lands on the month before and an arbitrary 10-day window steps 10 days.
  const shift = (direction: 1 | -1) => {
    const span = dayNumber(range.end) - dayNumber(range.start) + 1;
    setRange(
      addDays(range.start, direction * span),
      addDays(range.end, direction * span),
    );
  };

  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
      <SelectFilter
        label="Line of business"
        value={lineOfBusiness}
        options={lineOfBusinessOptions}
        labels={LINE_OF_BUSINESS_LABELS}
        onChange={onLineOfBusinessChange}
      />

      <div className="flex flex-col gap-1.5">
        <FilterLabel>Period</FilterLabel>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Previous period"
            onClick={() => shift(-1)}
          >
            <IconChevronLeft className="size-4" />
          </Button>
          <EndpointPicker
            value={range.start}
            onChange={(next) => setRange(next, range.end)}
            max={range.end}
            ariaLabel="Period start"
          />
          <span className="text-sm text-muted-foreground">–</span>
          <EndpointPicker
            value={range.end}
            onChange={(next) => setRange(range.start, next)}
            min={range.start}
            ariaLabel="Period end"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Next period"
            onClick={() => shift(1)}
          >
            <IconChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <FilterLabel>Forecast</FilterLabel>
        <div className="flex h-9 items-center gap-2">
          <Switch
            id="include-tentative"
            checked={includeTentative}
            onCheckedChange={onIncludeTentativeChange}
          />
          <label htmlFor="include-tentative" className="text-sm">
            Include tentative roles
          </label>
        </div>
        <p className="max-w-xs text-xs text-muted-foreground">
          Affects the utilization and staff breakdown only. Tentative roles
          count at full weight — there is no win probability to weight them by.
        </p>
      </div>
    </div>
  );
}
