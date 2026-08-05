"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { usePathname, useRouter } from "next/navigation";
import { EndpointPicker } from "@/components/form/endpoint-picker";
import { FilterLabel, SelectFilter } from "@/components/form/filters";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import {
  matchingPreset,
  presetRange,
  RANGE_PRESET_LABELS,
  RANGE_PRESETS,
  shiftRange,
} from "@/lib/reporting/report-range";
import type {
  ReportBasis,
  UtilizationRange,
} from "@/lib/utilization/utilization-report";

/**
 * The report's control bar: which series to show, which practice to look at, and
 * over what period.
 *
 * The **date range lives in the URL** — it bounds the server query, and a report
 * worth reading is worth linking to — while the basis and the line-of-business
 * filter are in-memory client state, since neither changes what has to be
 * fetched. `today` is resolved on the server and passed down so the preset
 * highlight can't disagree with the window the page defaulted to across a
 * timezone boundary.
 */
export function UtilizationFilters({
  range,
  today,
  basis,
  onBasisChange,
  canViewLogged,
  lineOfBusinessOptions,
  lineOfBusiness,
  onLineOfBusinessChange,
}: {
  range: UtilizationRange;
  today: string;
  basis: ReportBasis;
  onBasisChange: (value: ReportBasis) => void;
  canViewLogged: boolean;
  lineOfBusinessOptions: string[];
  lineOfBusiness: string;
  onLineOfBusinessChange: (value: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const activePreset = matchingPreset(range, today);

  const setRange = (start: string, end: string) => {
    const params = new URLSearchParams({ start, end });
    router.replace(`${pathname}?${params.toString()}`);
  };

  const shift = (direction: 1 | -1) => {
    const next = shiftRange(range, direction, today);
    setRange(next.start, next.end);
  };

  return (
    <div className="flex flex-col gap-3 rounded border p-4">
      {/* Three controls, labels on one baseline. The shortcuts belong to the date
          range, so they sit inside its group flush under the pickers rather than
          floating in a row of their own — they are the same control, reached a
          faster way. */}
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
              <IconChevronRight />
            </Button>
          </div>
          {/* A segmented strip, not four buttons: exactly one shortcut is active
              at a time, and none is when the range was picked by hand — which is
              the empty `value` Base UI is happy to render. */}
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
              setRange(next.start, next.end);
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
          value={lineOfBusiness}
          options={lineOfBusinessOptions}
          labels={LINE_OF_BUSINESS_LABELS}
          onChange={onLineOfBusinessChange}
        />

        <div className="flex flex-col gap-1.5">
          <FilterLabel>Basis</FilterLabel>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Basis"
            value={[basis]}
            // Single-select: ignore the empty array Base UI emits when the active
            // segment is pressed again, so one basis is always chosen.
            onValueChange={(values) => {
              const next = values[0];
              if (next === "planned" || next === "logged") onBasisChange(next);
            }}
          >
            <ToggleGroupItem value="planned">Planned</ToggleGroupItem>
            <ToggleGroupItem value="logged" disabled={!canViewLogged}>
              Logged
            </ToggleGroupItem>
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
