/**
 * Roomier cell padding for the app's data tables. The vendored `Table` primitive
 * (`src/components/ui/table.tsx`) is `p-2`, which crowds wide tables — most
 * visibly in the last column, where a right-aligned control (the tasks cell's
 * owner disc) ends up against the table edge. We don't hand-edit the vendored
 * primitives, so the override lives at the call site; this constant keeps every
 * call site saying the same thing.
 *
 * Both rules are descendant selectors on the `<Table>` element, so a plain class
 * on an individual `<td>` (specificity 0,1,0) would *lose* to `[&_td]:px-3`
 * (0,1,1). Per-cell overrides need matching-or-higher specificity — which is why
 * the last-column rule is written as `[&_td:last-child]` rather than a class on
 * the cell itself.
 */
export const ROOMY_TABLE =
  "[&_td:last-child]:pr-4 [&_td]:px-3 [&_th:last-child]:pr-4 [&_th]:px-3";
