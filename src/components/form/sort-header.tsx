"use client";

import {
  IconChevronDown,
  IconChevronUp,
  IconSelector,
} from "@tabler/icons-react";

/**
 * The sortable-column-header button, decoupled from any table engine.
 *
 * Most sortable tables here run on TanStack and bind through `SortHeader`
 * (`@/components/admin/table-filters`), which is a thin adapter over this. The
 * compensation-plan editor is deliberately not TanStack — it renders two `<tr>`s
 * per row for its expandable panel — so it binds to this directly with plain
 * props. One arrow implementation, two bindings.
 */

export type SortDirection = "asc" | "desc";

export type SortState<TKey extends string> = {
  key: TKey;
  dir: SortDirection;
};

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

/**
 * Compare two sort values. Nulls sort LAST in both directions — a row with no
 * proposal isn't "the smallest one", it's absent, and burying it under a descending
 * sort would be as wrong as floating it to the top of an ascending one.
 */
export function compareSortValues(
  a: string | number | null,
  b: string | number | null,
  dir: SortDirection,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  const sign = dir === "asc" ? 1 : -1;
  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b) * sign;
  }
  return ((a as number) - (b as number)) * sign;
}
