/**
 * Small presentational parts shared by the CRM detail views (company & contact)
 * so their tabs and empty states stay identical.
 */

/** A tab label with its count, so the counts are visible without switching. */
export function TabLabel({ label, count }: { label: string; count: number }) {
  return (
    <>
      {label}
      <span className="text-muted-foreground">{count}</span>
    </>
  );
}

/**
 * The empty-state note shown inside a bordered table container when a
 * collection has no rows — mirrors the list tables' "No … yet" placeholder.
 */
export function TableEmpty({ children }: { children: string }) {
  return (
    <p className="px-2 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
