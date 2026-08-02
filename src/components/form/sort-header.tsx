"use client";

import {
  IconChevronDown,
  IconChevronUp,
  IconSelector,
} from "@tabler/icons-react";
import type { SortDirection } from "@/lib/core/sort";

/**
 * The sortable-column-header button, decoupled from any table engine.
 *
 * Most sortable tables here run on TanStack and bind through `SortHeader`
 * (`@/components/admin/table-filters`), which is a thin adapter over this. The
 * compensation-plan editor is deliberately not TanStack — it renders two `<tr>`s
 * per row for its expandable panel — so it binds to this directly with plain
 * props, as does the projects list (whose sorting is server-side). One arrow
 * implementation, three bindings.
 *
 * The types and the comparison rule now live in `@/lib/core/sort`, a boundary-free
 * module the `server-only` reads can import too; they are re-exported here so the
 * existing call sites keep one import.
 */

export {
  compareSortValues,
  type SortDirection,
  type SortState,
} from "@/lib/core/sort";

export function SortHeaderButton({
  children,
  sorted,
  onClick,
}: {
  children: string;
  /** This column's direction, or `false` when another column is sorting. */
  sorted: SortDirection | false;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
