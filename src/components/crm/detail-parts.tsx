/**
 * Presentational skeleton shared by the CRM detail views (company & contact) so
 * the two pages are laid out by the *same* code: a fixed meta sidebar (identity,
 * scalar fields, then the inline-editable owner) beside a stack of titled main
 * sections for everything that hangs off the entity.
 */

import type { ReactNode } from "react";
import { EmptyCell } from "@/components/empty-cell";
import { EmptyState } from "@/components/empty-state";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Two-column detail page: a fixed-width meta sidebar beside the main column of
 * stacked sections. Collapses to a single stacked column on narrow screens
 * (sidebar first).
 */
export function DetailLayout({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:gap-10">
      <aside className="flex w-full flex-col gap-5 md:w-80 md:shrink-0">
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
    <div className="flex flex-col gap-3">
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
 * meta fields and, separately, the owner section beneath them.
 */
export function SidebarSection({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 border-t pt-5">{children}</div>;
}

/** A stacked label/value pair in the detail sidebar; em dash when empty. */
export function MetaField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <div className="text-sm">{children ?? <EmptyCell />}</div>
    </div>
  );
}

/**
 * A titled section in the detail main column: a heading with an optional count,
 * then its content (a table, an empty note, or grouped subsections).
 */
export function DetailSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight">
        {title}
        {count !== undefined ? (
          <span className="text-sm font-normal text-muted-foreground">
            {count}
          </span>
        ) : null}
      </h3>
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
      <Table>
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
