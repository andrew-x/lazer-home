/**
 * The em-dash placeholder for a table cell (or any inline slot) with no value.
 * Keeps the "no data" affordance consistent everywhere instead of repeating the
 * literal span + muted-foreground class.
 */
export function EmptyCell() {
  return <span className="text-muted-foreground">—</span>;
}
