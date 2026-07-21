import type { ReactNode } from "react";

/**
 * The empty-list placeholder shared across the CRM/projects/feedback tables and
 * detail sections: a centered muted "No … yet" note. Pass `bordered` to wrap it
 * in the same hairline `rounded-md border` container the detail sections and
 * some standalone lists use; omit it for the tables that render the note bare.
 * The message stays per-caller (it's passed as children) — only the styling is
 * shared here.
 */
export function EmptyState({
  children,
  bordered = false,
}: {
  children: ReactNode;
  bordered?: boolean;
}) {
  const note = (
    <p className="px-2 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );

  if (bordered) {
    return <div className="rounded-md border">{note}</div>;
  }

  return note;
}
