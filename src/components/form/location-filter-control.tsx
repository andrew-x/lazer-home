"use client";

import { useId } from "react";
import { searchCities } from "@/actions/cities/searchCities";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import { FilterLabel } from "@/components/form/filters";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/core/utils";

/**
 * The shared location filter control: a city picker (backed by the static
 * world-cities list via `searchCities`) plus a "Search nearby" switch that widens
 * the match to cities within a short travel radius of the picked one. Purely
 * presentational and state-agnostic — the caller owns `city`/`nearby` and decides
 * whether they live in the URL (companies/contacts lists) or local component
 * state (staff directory). "Search nearby" is disabled until a city is chosen.
 *
 * Location is stored as the label string, so the combobox's `EntityOption` uses
 * that label for both `id` and `name`.
 */
export function LocationFilterControl({
  city,
  nearby,
  onCityChange,
  onNearbyChange,
  fullWidth = false,
}: {
  city: string | null;
  nearby: boolean;
  onCityChange: (label: string | null) => void;
  onNearbyChange: (nearby: boolean) => void;
  /** Stretch the city picker to fill the available width (the control sits on
   * its own line) rather than its default fixed min-width. */
  fullWidth?: boolean;
}) {
  const nearbyId = useId();
  const value: EntityOption | null = city ? { id: city, name: city } : null;

  return (
    <div className={cn("flex flex-col gap-1.5", fullWidth && "w-full")}>
      <FilterLabel>Location</FilterLabel>
      <div className="flex flex-wrap items-center gap-3">
        <div className={cn("min-w-56", fullWidth && "flex-1")}>
          <EntityCombobox
            value={value}
            onChange={(next) => onCityChange(next?.id ?? null)}
            searchAction={searchCities}
            placeholder="Filter by city…"
          />
        </div>
        <div className="flex h-9 items-center gap-2 text-sm">
          <Switch
            id={nearbyId}
            checked={nearby}
            disabled={!city}
            onCheckedChange={onNearbyChange}
          />
          <label
            htmlFor={nearbyId}
            className={cn(!city && "text-muted-foreground")}
          >
            Search nearby
          </label>
        </div>
      </div>
    </div>
  );
}
