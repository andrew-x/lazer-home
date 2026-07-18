"use client";

import {
  IconChevronDown,
  IconChevronUp,
  IconSelector,
} from "@tabler/icons-react";
import type { Column } from "@tanstack/react-table";

// The generic filter controls now live in a neutral, app-wide location so the
// staff directory and performance dashboard can share them too. Re-exported here
// so the admin tables keep their existing `./table-filters` import site.
export {
  ALL,
  FilterLabel,
  SegmentedFilter,
  SelectFilter,
  TRISTATE,
  TriStateFilter,
} from "@/components/form/filters";

/** Sortable column header — click cycles asc → desc, with an arrow indicator. */
export function SortHeader<TData>({
  column,
  children,
}: {
  column: Column<TData, unknown>;
  children: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(sorted === "asc")}
      className="-mx-1 flex items-center gap-1 rounded-sm px-1 hover:text-foreground"
    >
      {children}
      {sorted === "asc" ? (
        <IconChevronUp className="size-3.5" />
      ) : sorted === "desc" ? (
        <IconChevronDown className="size-3.5" />
      ) : (
        <IconSelector className="size-3.5 text-muted-foreground" />
      )}
    </button>
  );
}
