/**
 * The empty-state message ladder shared by the entity comboboxes
 * (`EntityCombobox` / `EntityMultiCombobox`): before any input, prompt to
 * search; while the debounced search runs, say so; on failure, say so; and
 * otherwise report no matches. Kept in one place so both single- and
 * multi-select show identical copy.
 */
export function searchEmptyMessage({
  query,
  isPending,
  serverError,
}: {
  query: string;
  isPending: boolean;
  serverError?: string;
}): string {
  if (query.trim() === "") return "Type to search…";
  if (isPending) return "Searching…";
  if (serverError) return "Search failed — try again.";
  return "No matches.";
}
