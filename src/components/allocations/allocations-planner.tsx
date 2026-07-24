"use client";

import { IconSearch } from "@tabler/icons-react";
import { useId, useMemo, useState } from "react";
import type {
  AllocationStaffRow,
  AllocationsGridData,
} from "@/actions/allocations/getAllocationsGrid";
import {
  AllocationsGrid,
  AllocationsLegend,
} from "@/components/allocations/allocations-grid";
import { PlannerRange } from "@/components/allocations/planner-range";
import {
  ALL,
  FilterLabel,
  MultiSelectFilter,
  SegmentedFilter,
  SelectFilter,
} from "@/components/form/filters";
import { SkillsFilter } from "@/components/form/skills-filter";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  buildAllocationRows,
  buildColumns,
  defaultWindow,
  GRANULARITIES,
  GRANULARITY_LABELS,
  type Granularity,
} from "@/lib/allocations/allocations-grid";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { matchesSkillFilter } from "@/lib/staff/skills";
import {
  EMPLOYMENT_TYPE_LABELS,
  isBillableRole,
  ROLE_LABELS,
  type Role,
} from "@/lib/staff/staff-enums";

/**
 * The allocations planner: a filter bar + date-range window over a weekly grid
 * of active staff × their project allocations. All filtering is in-memory over
 * the list fetched once on the server (the staff-directory pattern); the date
 * range drives which week columns render.
 */
export function AllocationsPlanner({
  data,
  lineOfBusinessOptions,
  roleOptions,
  employmentTypeOptions,
}: {
  data: AllocationsGridData;
  lineOfBusinessOptions: string[];
  roleOptions: string[];
  employmentTypeOptions: string[];
}) {
  const canEditNotes = data.canEditNotes;
  const searchId = useId();
  const initialWindow = useMemo(() => defaultWindow("week"), []);
  // Default the role filter to the billable disciplines that actually appear in
  // the data, so the planner opens on the people who bill client work.
  const defaultRoles = useMemo(
    () => roleOptions.filter((option) => isBillableRole(option as Role)),
    [roleOptions],
  );
  const [search, setSearch] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);
  const [roles, setRoles] = useState<string[]>(defaultRoles);
  const [type, setType] = useState(ALL);
  const [skills, setSkills] = useState<string[]>([]);
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [start, setStart] = useState(initialWindow.start);
  const [end, setEnd] = useState(initialWindow.end);

  // Switching granularity re-seeds the range to that granularity's default
  // window (anchored at today) — a leftover week range makes no sense as days.
  const changeGranularity = (next: Granularity) => {
    setGranularity(next);
    const window = defaultWindow(next);
    setStart(window.start);
    setEnd(window.end);
  };

  const filteredStaff = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.staff.filter((person: AllocationStaffRow) => {
      if (query && !person.name.toLowerCase().includes(query)) return false;
      if (lineOfBusiness !== ALL && person.lineOfBusiness !== lineOfBusiness)
        return false;
      if (person.role === null || !roles.includes(person.role)) return false;
      if (type !== ALL && person.employmentType !== type) return false;
      if (!matchesSkillFilter(person.skills, skills)) return false;
      return true;
    });
  }, [data.staff, search, lineOfBusiness, roles, type, skills]);

  const columns = useMemo(
    () => buildColumns(granularity, start, end),
    [granularity, start, end],
  );

  const rows = useMemo(
    () =>
      buildAllocationRows(
        filteredStaff,
        data.roles,
        data.timeOff,
        columns,
        granularity,
      ),
    [filteredStaff, data.roles, data.timeOff, columns, granularity],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FilterLabel htmlFor={searchId}>Name</FilterLabel>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={searchId}
                type="search"
                placeholder="Search by name…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <SkillsFilter value={skills} onChange={setSkills} />
        </div>

        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SelectFilter
            label="Line of business"
            value={lineOfBusiness}
            options={lineOfBusinessOptions}
            labels={LINE_OF_BUSINESS_LABELS}
            onChange={setLineOfBusiness}
            triggerClassName="w-full"
          />
          <MultiSelectFilter
            label="Role"
            value={roles}
            options={roleOptions}
            labels={ROLE_LABELS}
            onChange={setRoles}
            placeholder="Filter by role…"
          />
          <SegmentedFilter
            label="Type"
            value={type}
            options={employmentTypeOptions}
            labels={EMPLOYMENT_TYPE_LABELS}
            onChange={setType}
          />
        </div>
      </div>

      {/* Planner window — its own control, not a staff filter: it changes which
          columns the grid shows, not which people. */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-t pt-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <FilterLabel>View by</FilterLabel>
            <ToggleGroup
              variant="outline"
              spacing={0}
              aria-label="Planner granularity"
              value={[granularity]}
              onValueChange={(values) => {
                if (values.length > 0)
                  changeGranularity(values[0] as Granularity);
              }}
            >
              {GRANULARITIES.map((option) => (
                <ToggleGroupItem key={option} value={option}>
                  {GRANULARITY_LABELS[option]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex flex-col gap-1.5">
            <FilterLabel>Planner range</FilterLabel>
            <PlannerRange
              start={start}
              end={end}
              granularity={granularity}
              onChange={(nextStart, nextEnd) => {
                setStart(nextStart);
                setEnd(nextEnd);
              }}
            />
          </div>
        </div>
        <AllocationsLegend />
      </div>

      {columns.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          Pick an end date on or after the start date to see the planner.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          No staff match these filters.
        </p>
      ) : (
        <AllocationsGrid
          rows={rows}
          columns={columns}
          granularity={granularity}
          canEditNotes={canEditNotes}
        />
      )}
    </div>
  );
}
