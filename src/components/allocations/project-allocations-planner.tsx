"use client";

import { IconSearch } from "@tabler/icons-react";
import { useCallback, useId, useMemo, useState } from "react";
import type {
  ProjectAllocationRoleRow,
  ProjectAllocationsGridData,
} from "@/actions/allocations/getProjectAllocationsGrid";
import { PlannerRange } from "@/components/allocations/planner-range";
import {
  ProjectAllocationsGrid,
  ProjectAllocationsLegend,
} from "@/components/allocations/project-allocations-grid";
import { StaffRoleDialog } from "@/components/allocations/staff-role-dialog";
import { toEnumValue } from "@/components/form/enum-select";
import {
  ALL,
  FilterLabel,
  SegmentedFilter,
  SelectFilter,
} from "@/components/form/filters";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  buildColumns,
  defaultWindow,
  GRANULARITIES,
  GRANULARITY_LABELS,
  type Granularity,
} from "@/lib/allocations/allocations-grid";
import { buildProjectAllocationRows } from "@/lib/allocations/project-allocations-grid";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import {
  PROJECT_ROLE_STATUS_LABELS,
  ROLE_STATUS,
} from "@/lib/projects/project-role-status";
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/projects/project-role-type";

/**
 * The two live planning states, as a filter dimension. `ALL` covers exactly
 * these two — `paused`/`cancelled` roles are not allocations and never reach
 * this view (see `getProjectAllocationsGrid`).
 */
const STATUS_OPTIONS = [ROLE_STATUS.tentative, ROLE_STATUS.confirmed];

/** Staffed vs. open, as a filter dimension. `ALL` is both. */
const STAFFING_STAFFED = "STAFFED";
const STAFFING_UNSTAFFED = "UNSTAFFED";
const STAFFING_OPTIONS = [STAFFING_STAFFED, STAFFING_UNSTAFFED];
const STAFFING_LABELS: Record<string, string> = {
  [STAFFING_STAFFED]: "Staffed",
  [STAFFING_UNSTAFFED]: "Unstaffed",
};

/**
 * The by-project allocations planner: a filter bar + date-range window over a
 * grid of projects and their roles. All filtering is in-memory over the list
 * fetched once on the server (the same shape as `AllocationsPlanner`); the date
 * range drives which columns render *and*, because a role idle in every column
 * is dropped, which roles and projects appear at all.
 *
 * Filters here narrow **roles**, not projects: a project disappears when none of
 * its roles survive. That's what makes "Unstaffed" useful — it turns the grid
 * into a list of the gaps.
 */
export function ProjectAllocationsPlanner({
  data,
  lineOfBusinessOptions,
  roleTypeOptions,
}: {
  data: ProjectAllocationsGridData;
  lineOfBusinessOptions: readonly string[];
  roleTypeOptions: readonly string[];
}) {
  const searchId = useId();
  const initialWindow = useMemo(() => defaultWindow("week"), []);
  const [search, setSearch] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);
  const [roleType, setRoleType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [staffing, setStaffing] = useState(ALL);
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [start, setStart] = useState(initialWindow.start);
  const [end, setEnd] = useState(initialWindow.end);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The open role whose staffing dialog is showing (null = closed).
  const [staffRoleFor, setStaffRoleFor] =
    useState<ProjectAllocationRoleRow | null>(null);

  // Switching granularity re-seeds the range to that granularity's default
  // window (anchored at today), as the staff view does.
  const changeGranularity = (next: Granularity) => {
    setGranularity(next);
    const window = defaultWindow(next);
    setStart(window.start);
    setEnd(window.end);
  };

  const toggleProject = useCallback((projectId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(projectId)) next.add(projectId);
      return next;
    });
  }, []);

  const filteredRoles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.roles.filter((role) => {
      if (
        query &&
        !role.projectName.toLowerCase().includes(query) &&
        !role.companyName.toLowerCase().includes(query)
      ) {
        return false;
      }
      if (lineOfBusiness !== ALL && role.lineOfBusiness !== lineOfBusiness)
        return false;
      if (roleType !== ALL && role.roleType !== roleType) return false;
      if (status !== ALL && role.status !== status) return false;
      if (staffing === STAFFING_STAFFED && role.staffId === null) return false;
      if (staffing === STAFFING_UNSTAFFED && role.staffId !== null)
        return false;
      return true;
    });
  }, [data.roles, search, lineOfBusiness, roleType, status, staffing]);

  const columns = useMemo(
    () => buildColumns(granularity, start, end),
    [granularity, start, end],
  );

  const rows = useMemo(
    () => buildProjectAllocationRows(filteredRoles, columns, granularity),
    [filteredRoles, columns, granularity],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <FilterLabel htmlFor={searchId}>Project</FilterLabel>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={searchId}
                type="search"
                placeholder="Search by project or client…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <SelectFilter
            label="Line of business"
            value={lineOfBusiness}
            options={lineOfBusinessOptions}
            labels={LINE_OF_BUSINESS_LABELS}
            onChange={setLineOfBusiness}
            triggerClassName="w-full"
          />
        </div>

        <div className="grid grid-cols-1 items-end gap-4 lg:grid-cols-3">
          <SegmentedFilter
            label="Role"
            value={roleType}
            options={roleTypeOptions}
            labels={PROJECT_ROLE_TYPE_LABELS}
            onChange={setRoleType}
          />
          <SegmentedFilter
            label="Status"
            value={status}
            options={STATUS_OPTIONS}
            labels={PROJECT_ROLE_STATUS_LABELS}
            onChange={setStatus}
          />
          <SegmentedFilter
            label="Staffing"
            value={staffing}
            options={STAFFING_OPTIONS}
            labels={STAFFING_LABELS}
            onChange={setStaffing}
          />
        </div>
      </div>

      {/* Planner window — its own control, not a role filter: it changes which
          columns the grid shows (and so which roles are in view). */}
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
                const next = toEnumValue(GRANULARITIES, values[0] ?? null);
                if (next) changeGranularity(next);
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
        <ProjectAllocationsLegend />
      </div>

      {columns.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          Pick an end date on or after the start date to see the planner.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          No project roles match these filters in this date range.
        </p>
      ) : (
        <ProjectAllocationsGrid
          rows={rows}
          columns={columns}
          granularity={granularity}
          expanded={expanded}
          onToggleProject={toggleProject}
          canAllocate={data.canAllocate}
          onStaffRole={setStaffRoleFor}
        />
      )}

      {staffRoleFor ? (
        <StaffRoleDialog
          role={staffRoleFor}
          onClose={() => setStaffRoleFor(null)}
          onSaved={() => setStaffRoleFor(null)}
        />
      ) : null}
    </div>
  );
}
