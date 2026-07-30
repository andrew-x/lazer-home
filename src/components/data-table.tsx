"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DataTableProps<TData> = {
  // biome-ignore lint/suspicious/noExplicitAny: column value types vary per column.
  columns: ColumnDef<TData, any>[];
  data: TData[];
  emptyMessage?: string;
  /**
   * Turns on client-side sorting, seeded with this initial sort. Omit for an
   * unsorted table — the three import-preview call sites predate sorting and
   * must keep their server-given row order.
   *
   * The table owns the sorting state (nothing outside it needs to read the
   * current sort); columns opt in individually via a `SortHeader` header, so a
   * column with a plain string header stays unsortable.
   */
  defaultSorting?: SortingState;
  /** Extra classes for the `<table>` itself — e.g. `ROOMY_TABLE` from
   * `@/components/table-density`, or a sticky-header fragment. */
  className?: string;
};

/**
 * Minimal TanStack table rendered with the shadcn table primitives.
 *
 * Lives here rather than under `admin/` because it is no longer admin-only —
 * `admin/data-table.tsx` re-exports it so the existing import sites don't churn.
 * Same move the filter controls made to `@/components/form/filters`.
 */
export function DataTable<TData>({
  columns,
  data,
  emptyMessage = "No rows.",
  defaultSorting,
  className,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(defaultSorting ?? []);
  const sortable = defaultSorting !== undefined;

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    ...(sortable
      ? {
          state: { sorting },
          onSortingChange: setSorting,
          getSortedRowModel: getSortedRowModel(),
        }
      : {}),
  });

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className={className}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="whitespace-nowrap">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="whitespace-nowrap">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-20 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
