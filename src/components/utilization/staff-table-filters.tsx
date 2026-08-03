"use client";

import { IconSearch } from "@tabler/icons-react";
import { useId, useState } from "react";
import {
  ALL,
  FilterLabel,
  SegmentedFilter,
  SelectFilter,
} from "@/components/form/filters";
import { Input } from "@/components/ui/input";
import type { EmploymentType, Role } from "@/lib/staff/staff-enums";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";

/**
 * Name search, employment type and role, shared by the utilization report's two
 * per-person tables (staff breakdown and line-of-business alignment). Each table
 * owns its **own** instance: they answer different questions, and someone
 * narrowing one has no reason to be narrowing the other.
 *
 * Filtering and paging are both in-memory. The whole cohort is already in the
 * client — the report fetches one projection and derives every card from it — so
 * routing this through the URL would re-run six queries on the server to slice an
 * array that is already sitting in front of us.
 */
export const REPORT_PAGE_SIZE = 20;

/** The fields a row must expose to be filterable here. */
export type StaffTableRow = {
  name: string;
  role: Role | null;
  employmentType: EmploymentType | null;
};

export type StaffTableFilterState = ReturnType<typeof useStaffTableFilters>;

export function useStaffTableFilters() {
  const [search, setSearchValue] = useState("");
  const [type, setTypeValue] = useState(ALL);
  const [role, setRoleValue] = useState(ALL);
  const [page, setPage] = useState(1);

  // Any filter change sends the reader back to page 1: page 4 of the full roster
  // is usually past the end of a filtered one.
  const andResetPage =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  const query = search.trim().toLowerCase();

  return {
    search,
    setSearch: andResetPage(setSearchValue),
    type,
    setType: andResetPage(setTypeValue),
    role,
    setRole: andResetPage(setRoleValue),
    page,
    setPage,
    matches: (row: StaffTableRow) => {
      if (query && !row.name.toLowerCase().includes(query)) return false;
      if (type !== ALL && row.employmentType !== type) return false;
      if (role !== ALL && row.role !== role) return false;
      return true;
    },
  };
}

/**
 * Slice `rows` to the current page, clamping to the last page that still has
 * rows — so a filter that shrinks the set doesn't leave the reader on an empty
 * page they have to click their way out of.
 */
export function paginate<T>(
  rows: readonly T[],
  page: number,
): { visible: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / REPORT_PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const from = (current - 1) * REPORT_PAGE_SIZE;
  return {
    visible: rows.slice(from, from + REPORT_PAGE_SIZE),
    page: current,
    pageCount,
  };
}

export function StaffTableFilters({
  filters,
  roleOptions,
  typeOptions,
  shown,
  total,
}: {
  filters: StaffTableFilterState;
  roleOptions: string[];
  typeOptions: string[];
  /** Rows passing the filter, and the cohort size, for the running count. */
  shown: number;
  total: number;
}) {
  const searchId = useId();

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="flex flex-col gap-1.5">
        <FilterLabel htmlFor={searchId}>Name</FilterLabel>
        <div className="relative">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={searchId}
            type="search"
            placeholder="Search by name…"
            value={filters.search}
            onChange={(event) => filters.setSearch(event.target.value)}
            className="w-56 pl-9"
          />
        </div>
      </div>

      <SegmentedFilter
        label="Type"
        value={filters.type}
        options={typeOptions}
        labels={EMPLOYMENT_TYPE_LABELS}
        onChange={filters.setType}
      />

      <SelectFilter
        label="Role"
        value={filters.role}
        options={roleOptions}
        labels={ROLE_LABELS}
        onChange={filters.setRole}
      />

      <p className="flex h-9 items-center text-sm text-muted-foreground">
        {shown === total
          ? `${total} ${total === 1 ? "person" : "people"}`
          : `${shown} of ${total} people`}
      </p>
    </div>
  );
}
