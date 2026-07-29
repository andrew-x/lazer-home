"use client";

import type { Column } from "@tanstack/react-table";
import { SortHeaderButton } from "@/components/form/sort-header";

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

/**
 * Sortable column header for a TanStack table — click cycles asc → desc.
 *
 * A binding, not an implementation: the button and its arrow live in
 * `@/components/form/sort-header` so the one non-TanStack sortable table (the
 * compensation-plan editor) renders an identical header from plain props.
 */
export function SortHeader<TData>({
  column,
  children,
}: {
  column: Column<TData, unknown>;
  children: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <SortHeaderButton
      sorted={sorted === false ? false : sorted}
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {children}
    </SortHeaderButton>
  );
}
