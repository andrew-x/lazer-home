"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { usePathname, useRouter } from "next/navigation";
import { EndpointPicker } from "@/components/form/endpoint-picker";
import { ALL, FilterLabel, SelectFilter } from "@/components/form/filters";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import type { DisplayCurrency } from "@/lib/format/currency";
import { DISPLAY_CURRENCIES } from "@/lib/format/currency";
import {
  matchingPreset,
  presetRange,
  RANGE_END_PARAM,
  RANGE_PRESET_LABELS,
  RANGE_PRESETS,
  RANGE_START_PARAM,
  type ReportRange,
  shiftRange,
} from "@/lib/reporting/report-range";

/** The search param carrying the line-of-business filter. */
export const LINE_OF_BUSINESS_PARAM = "lob";

/**
 * The finance report's control bar: over what period, which practice, and in which
 * currency.
 *
 * **Both the range and the line of business live in the URL**, unlike the
 * utilization report where only the range does. Here the practice filter changes
 * which roles are counted — and therefore how a fixed fee prorates — so it has to
 * be applied where the aggregation happens, on the server. The upside is that a
 * filtered view is linkable, which is what a finance figure usually needs to be.
 *
 * **Currency is client state**, because both currencies are already computed and
 * shipped: the toggle picks between two finished aggregates rather than asking for
 * anything, so a round-trip would buy nothing.
 *
 * `today` is resolved on the server and passed down so the preset highlight can't
 * disagree with the window the page defaulted to across a timezone boundary.
 */
export function FinanceFilters({
  range,
  today,
  lineOfBusinessOptions,
  lineOfBusiness,
  currency,
  onCurrencyChange,
}: {
  range: ReportRange;
  today: string;
  lineOfBusinessOptions: readonly string[];
  lineOfBusiness: LineOfBusiness | null;
  currency: DisplayCurrency;
  onCurrencyChange: (value: DisplayCurrency) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const activePreset = matchingPreset(range, today);

  // Every URL write goes through here, so the range and the practice can never
  // clobber one another — a `router.replace` that carried only its own param would
  // silently reset the other filter.
  const navigate = (next: {
    start?: string;
    end?: string;
    lineOfBusiness?: LineOfBusiness | null;
  }) => {
    const params = new URLSearchParams({
      [RANGE_START_PARAM]: next.start ?? range.start,
      [RANGE_END_PARAM]: next.end ?? range.end,
    });
    const lob =
      next.lineOfBusiness === undefined ? lineOfBusiness : next.lineOfBusiness;
    if (lob) params.set(LINE_OF_BUSINESS_PARAM, lob);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const shift = (direction: 1 | -1) => {
    const next = shiftRange(range, direction, today);
    navigate({ start: next.start, end: next.end });
  };

  return (
    <div className="flex flex-col gap-3 rounded border p-4">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <div className="flex flex-col gap-1.5">
          <FilterLabel>Date range</FilterLabel>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Previous period"
              onClick={() => shift(-1)}
            >
              <IconChevronLeft />
            </Button>
            <EndpointPicker
              value={range.start}
              onChange={(next) => navigate({ start: next })}
              max={range.end}
              ariaLabel="Period start"
            />
            <span className="text-sm text-muted-foreground">–</span>
            <EndpointPicker
              value={range.end}
              onChange={(next) => navigate({ end: next })}
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
              <IconChevronRight />
            </Button>
          </div>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Date range shortcuts"
            value={activePreset ? [activePreset] : []}
            onValueChange={(values) => {
              const picked = RANGE_PRESETS.find((p) => p === values[0]);
              if (!picked) return; // pressing the active shortcut again is a no-op
              const next = presetRange(picked, today);
              navigate({ start: next.start, end: next.end });
            }}
          >
            {RANGE_PRESETS.map((preset) => (
              <ToggleGroupItem key={preset} value={preset}>
                {RANGE_PRESET_LABELS[preset]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <SelectFilter
          label="Line of business"
          value={lineOfBusiness ?? ALL}
          options={lineOfBusinessOptions}
          labels={LINE_OF_BUSINESS_LABELS}
          onChange={(next) =>
            navigate({
              lineOfBusiness: next === ALL ? null : (next as LineOfBusiness),
            })
          }
        />

        <div className="flex flex-col gap-1.5">
          <FilterLabel>Currency</FilterLabel>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Currency"
            value={[currency]}
            // Single-select: ignore the empty array Base UI emits when the active
            // segment is pressed again, so one currency is always chosen.
            onValueChange={(values) => {
              const next = DISPLAY_CURRENCIES.find((c) => c === values[0]);
              if (next) onCurrencyChange(next);
            }}
          >
            {DISPLAY_CURRENCIES.map((code) => (
              <ToggleGroupItem key={code} value={code}>
                {code}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        An in-progress period runs to today. The arrows step whole periods; a
        hand-picked range slides by its own length.
      </p>
    </div>
  );
}
