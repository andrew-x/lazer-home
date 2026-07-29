"use client";

import { IconSearch } from "@tabler/icons-react";
import { useId } from "react";
import {
  FilterLabel,
  SegmentedFilter,
  SelectFilter,
} from "@/components/form/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import {
  COMPENSATION_PLAN_ITEM_STATUS_LABELS,
  COMPENSATION_PLAN_ITEM_STATUSES,
} from "@/lib/performance/compensation-plan";
import { BILLABLE_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";
import { STAFF_FILTER_OPTIONS } from "@/lib/staff/staff-filters";
import {
  EMPTY_PLAN_FILTERS,
  hasActivePlanFilters,
  type PlanFilters,
} from "./plan-view";

/**
 * The plan editor's filter bar: find one person by name, or work a slice of the
 * round at a time. A comp round covers dozens of people, and reviewing "all Hub
 * engineers" — or "everyone still waiting on a meeting" — together is how the
 * numbers get compared against each other rather than one at a time.
 *
 * Laid out on a fixed grid rather than a wrapping flex row, so the controls line up
 * with each other and don't reflow as you type or as the reset affordance appears.
 * The last cell stays empty until there is something to reset, which is what keeps
 * the others from shifting.
 *
 * Filtering is in-memory over the already-loaded rows — see `plan-view.ts`.
 */
export function PlanToolbar({
  filters,
  onFiltersChange,
  visibleCount,
  totalCount,
}: {
  filters: PlanFilters;
  onFiltersChange: (next: PlanFilters) => void;
  visibleCount: number;
  totalCount: number;
}) {
  const searchId = useId();

  return (
    <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      <div className="flex min-w-0 flex-col gap-1.5">
        <FilterLabel htmlFor={searchId}>Name</FilterLabel>
        <div className="relative">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={searchId}
            type="search"
            placeholder="Search by name…"
            className="pl-9"
            value={filters.query}
            onChange={(event) =>
              onFiltersChange({ ...filters, query: event.target.value })
            }
          />
        </div>
      </div>

      {/* `w-full` so each trigger fills its grid cell — the shared default is a
          fixed `w-44`, which would leave the columns visibly ragged. */}
      <SelectFilter
        label="Line of business"
        value={filters.lineOfBusiness}
        options={STAFF_FILTER_OPTIONS.lineOfBusiness}
        labels={LINE_OF_BUSINESS_LABELS}
        triggerClassName="w-full"
        onChange={(lineOfBusiness) =>
          onFiltersChange({ ...filters, lineOfBusiness })
        }
      />

      <SelectFilter
        label="Role"
        value={filters.role}
        options={STAFF_FILTER_OPTIONS.role}
        labels={ROLE_LABELS}
        triggerClassName="w-full"
        onChange={(role) => onFiltersChange({ ...filters, role })}
      />

      {/* Segmented rather than a dropdown: two options plus "All" is small enough
          that showing the choices beats hiding them, and Hub vs Global is the cut
          you switch between most often. Status stays a dropdown — five options
          would make an unreadably wide control. */}
      <SegmentedFilter
        label="Pool"
        value={filters.billableType}
        options={STAFF_FILTER_OPTIONS.billableType}
        labels={BILLABLE_TYPE_LABELS}
        onChange={(billableType) =>
          onFiltersChange({ ...filters, billableType })
        }
      />

      <SelectFilter
        label="Status"
        value={filters.status}
        options={COMPENSATION_PLAN_ITEM_STATUSES}
        labels={COMPENSATION_PLAN_ITEM_STATUS_LABELS}
        triggerClassName="w-full"
        onChange={(status) => onFiltersChange({ ...filters, status })}
      />

      {hasActivePlanFilters(filters) ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          {/* Stated so a filtered view can't be mistaken for the whole round —
              committing acts on everyone, not just who's on screen. */}
          <FilterLabel>Showing</FilterLabel>
          <div className="flex items-center gap-2">
            <span className="text-sm tabular-nums">
              {visibleCount} of {totalCount}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onFiltersChange(EMPTY_PLAN_FILTERS)}
            >
              Clear
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
