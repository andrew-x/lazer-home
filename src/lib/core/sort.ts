/**
 * Sorting primitives shared by client tables and server-side reads.
 *
 * A pure, boundary-free module (no `db`, no React) so the same comparison rule
 * runs in a client component sorting rows it already holds *and* in a
 * `server-only` read sorting a set it just assembled. Extracted from
 * `src/components/form/sort-header.tsx` — which still re-exports all three names
 * for its existing consumers — when the projects list needed the nulls-last rule
 * on the server.
 */

export type SortDirection = "asc" | "desc";

export type SortState<TKey extends string> = {
  key: TKey;
  dir: SortDirection;
};

/**
 * Compare two sort values. Nulls sort LAST in both directions — a row with no
 * proposal isn't "the smallest one", it's absent, and burying it under a descending
 * sort would be as wrong as floating it to the top of an ascending one. The projects
 * list relies on this for "Not rated" health and the "No budget" / "No roles" margins:
 * a project nobody has priced is unknown, not the worst one.
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
