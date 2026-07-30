/**
 * Presentational skeleton shared by the CRM detail views (company & contact) so
 * the two pages are laid out by the *same* code: a fixed meta sidebar (identity,
 * scalar fields, then the inline-editable owner) beside a stack of titled main
 * sections for everything that hangs off the entity.
 */

import type { ReactNode } from "react";
import { EmptyCell } from "@/components/empty-cell";
import { EmptyState } from "@/components/empty-state";
import { COMPACT_META_FIELDS } from "@/components/form/field-density";
import { ROOMY_TABLE } from "@/components/table-density";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/core/utils";

/**
 * Two-column detail page: a fixed-width meta sidebar beside the main column of
 * stacked sections. Collapses to a single stacked column on narrow screens
 * (sidebar first). Centred at `max-w-6xl` by default; pass `fullWidth` when the
 * main column needs the whole page (e.g. a wide timeline) — the sidebar keeps
 * its fixed width and the main column takes the rest.
 */
export function DetailLayout({
  sidebar,
  children,
  fullWidth = false,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-6 md:flex-row md:gap-8",
        fullWidth ? "w-full" : "mx-auto max-w-6xl",
      )}
    >
      <aside className="flex w-full flex-col gap-4 md:w-80 md:shrink-0">
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-8">{children}</div>
    </div>
  );
}

/**
 * The identity block at the top of a detail sidebar: the icon/avatar and the
 * edit affordance on one row, then the name (with any adornment) and an optional
 * subtitle beneath.
 */
export function DetailIdentity({
  media,
  title,
  subtitle,
  action,
}: {
  media: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        {media}
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">{title}</div>
        {subtitle ? (
          <div className="text-sm text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A group of sidebar content set off by a hairline divider — used for the scalar
 * meta fields and, separately, the inline-editable owner section beneath them.
 *
 * The section also owns the sidebar's **label styling** (small, uppercase, muted)
 * and its **row density** ({@link COMPACT_META_FIELDS}) via descendant selectors
 * rather than each field applying them. Both {@link MetaField} and `FormField`
 * (through `InlineEditField`) emit labels in here, so styling per-field would mean
 * threading a prop through both and forwarding it through `InlineEditField`, and
 * putting a `variant` on `FormField` would push a sidebar-only concern into the
 * app's most-used form primitive. Targeting `[data-slot=label]` (not `label`)
 * keeps the selector pinned to our own `Label`, so a checkbox/switch label inside
 * some future edit control can't get swept up in it.
 */
export function SidebarSection({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-t pt-4 [&_[data-slot=label]]:text-xs [&_[data-slot=label]]:font-medium [&_[data-slot=label]]:uppercase [&_[data-slot=label]]:tracking-wide [&_[data-slot=label]]:text-muted-foreground",
        COMPACT_META_FIELDS,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A stacked label/value pair in the detail sidebar; em dash when empty. Geometry
 * matches `FormField`/`InlineEditField` (`gap-1.5`, a `min-h-8 py-1` value box) so
 * read-only rows and inline-editable rows sitting in the same sidebar share one
 * vertical rhythm — including when {@link SidebarSection} tightens both at once
 * (hence the `data-slot`s, which are what those overrides hook onto).
 *
 * Deliberately renders a `Label` even though it labels no control: that's what
 * carries the `data-slot="label"` {@link SidebarSection} styles. Swapping it for a
 * `<span>` would be more correct a11y-wise but would fork the sidebar back into
 * two label-styling paths.
 */
export function MetaField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div data-slot="form-field" className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div data-slot="field-value" className="min-h-8 py-1 text-sm">
        {children ?? <EmptyCell />}
      </div>
    </div>
  );
}

/**
 * A titled group *inside* a detail sidebar — the narrow rail's counterpart to
 * {@link DetailSection}. Renders the sidebar's label styling (inherited from
 * {@link SidebarSection}'s `[data-slot=label]` selector, which is why this emits a
 * `Label`) with an optional right-aligned action, then stacked rows.
 *
 * Deliberately unlike `DetailSection`: no count in the heading (a rail group holds
 * several heterogeneous collections, so one total means nothing), no table (the
 * rail is 320px — `DetailTable`'s columns don't fit), and no border of its own
 * (`SidebarSection` owns that).
 */
export function SidebarGroup({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * A titled section in the detail main column: a heading with an optional count,
 * then its content (a table, an empty note, or grouped subsections). `action`
 * fills an optional right-aligned slot on the heading row (e.g. an "Add role"
 * button), mirroring the staff profile's `TabSection` so every section's action
 * sits in its own header.
 */
export function DetailSection({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight">
          {title}
          {count !== undefined ? (
            <span className="text-sm font-normal text-muted-foreground">
              {count}
            </span>
          ) : null}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A bordered list table for a detail section: a header row of the given column
 * labels, then the caller's `<TableRow>` body cells. The shared shape behind the
 * company/contact detail tables — only the columns and row cells differ, so those
 * stay with each caller while this owns the border + table scaffold. Use
 * {@link TableEmpty} for the no-rows state (headers are dropped when empty, as the
 * detail views do).
 */
export function DetailTable({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border">
      <Table className={ROOMY_TABLE}>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header}>{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

/**
 * The no-rows state for a detail section: the same bordered container as
 * {@link DetailTable}, holding a centered "No … yet" note in place of a table.
 * A thin wrapper over the shared {@link EmptyState} (bordered variant), kept as
 * the named entry point the detail views reach for.
 */
export function TableEmpty({ children }: { children: string }) {
  return <EmptyState bordered>{children}</EmptyState>;
}
