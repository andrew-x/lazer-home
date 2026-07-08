"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type OnChangeFn,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * TanStack `table.options.meta` shape shared by the editable cell editors: they
 * read the current draft value for a row and push patches back into the draft.
 */
export type EditableTableMeta<TValues> = {
  valuesFor: (id: string) => TValues;
  update: (id: string, patch: Partial<TValues>) => void;
};

export type UseEditableRows<TRow, TValues> = {
  /** Current (possibly edited) values for a row; throws if the id is unknown. */
  valuesFor: (id: string) => TValues;
  /** Merge a patch into a row's draft (via `applyPatch`); throws on miss. */
  update: (id: string, patch: Partial<TValues>) => void;
  /** Whether a row's draft differs from its original on any tracked field. */
  isChanged: (id: string) => boolean;
  /** Rows whose drafts differ from their originals, in `rows` order. */
  changedRows: TRow[];
  /** Discard every draft. */
  reset: () => void;
  /** Original (server) values keyed by row id. */
  originalById: Map<string, TValues>;
  /** Pass straight to `useReactTable({ meta })` for the cell editors. */
  meta: EditableTableMeta<TValues>;
};

/**
 * Client-side draft state machine for a bulk-edit table: tracks per-row edits
 * against the originals, exposes the changed set, and hands TanStack a `meta`
 * the cell editors read/write through. `applyPatch` lets a screen enforce
 * cross-field invariants when merging a patch (defaults to a shallow merge).
 */
export function useEditableRows<TRow, TValues>({
  rows,
  getRowId,
  getEditableValues,
  fields,
  applyPatch = (base, patch) => ({ ...base, ...patch }),
}: {
  rows: TRow[];
  getRowId: (row: TRow) => string;
  getEditableValues: (row: TRow) => TValues;
  fields: readonly (keyof TValues)[];
  applyPatch?: (base: TValues, patch: Partial<TValues>) => TValues;
}): UseEditableRows<TRow, TValues> {
  const [edited, setEdited] = useState<Record<string, TValues>>({});

  const originalById = useMemo(
    () => new Map(rows.map((row) => [getRowId(row), getEditableValues(row)])),
    [rows, getRowId, getEditableValues],
  );

  // A missing original means the draft/render code drifted from the data — fail
  // loudly rather than propagate an `undefined` typed as a value.
  const requireOriginal = (id: string): TValues => {
    const original = originalById.get(id);
    if (!original) throw new Error(`No original values for row ${id}`);
    return original;
  };

  const valuesFor = (id: string): TValues => edited[id] ?? requireOriginal(id);

  const update = (id: string, patch: Partial<TValues>) => {
    setEdited((prev) => {
      const base = prev[id] ?? requireOriginal(id);
      return { ...prev, [id]: applyPatch(base, patch) };
    });
  };

  const isChanged = (id: string): boolean => {
    const draft = edited[id];
    if (!draft) return false;
    const original = originalById.get(id);
    if (!original) return false;
    return fields.some((field) => draft[field] !== original[field]);
  };

  const changedRows = rows.filter((row) => isChanged(getRowId(row)));

  const reset = () => setEdited({});

  return {
    valuesFor,
    update,
    isChanged,
    changedRows,
    reset,
    originalById,
    meta: { valuesFor, update },
  };
}

/**
 * Generic editable table: the sortable render loop, the floating save bar, and
 * the confirm-diff dialog, parameterized over a row type and its editable
 * values. A screen supplies its column defs (with cell editors that read the
 * `editable.meta`), a field label map, a `formatValue`, and the commit wiring;
 * everything about tracking edits and confirming diffs lives here.
 *
 * The confirm dialog closes itself once there are no changes left — i.e. after a
 * successful save resets the drafts, or after Discard.
 */
export function EditableTable<TRow, TValues>({
  editable,
  rows,
  columns,
  sorting,
  onSortingChange,
  getRowId,
  getRowLabel,
  emptyMessage,
  fields,
  fieldLabels,
  formatValue,
  itemNoun,
  dialogDescription,
  saveBarExtras,
  onDiscard,
  onSave,
  isSaving,
}: {
  editable: UseEditableRows<TRow, TValues>;
  /** Filtered + sorted rows to display. */
  rows: TRow[];
  // biome-ignore lint/suspicious/noExplicitAny: column value types vary per column.
  columns: ColumnDef<TRow, any>[];
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  getRowId: (row: TRow) => string;
  getRowLabel: (row: TRow) => string;
  emptyMessage: string;
  /** Editable fields to diff and render in the confirm dialog. */
  fields: readonly (keyof TValues)[];
  fieldLabels: Record<keyof TValues, string>;
  formatValue: (field: keyof TValues, value: TValues[keyof TValues]) => string;
  /** Plural noun for the "{n} {noun} changed" save-bar label. */
  itemNoun: string;
  dialogDescription: (count: number) => string;
  /** Extra controls rendered in the save bar, before Discard/Save. */
  saveBarExtras?: ReactNode;
  /** Extra cleanup on Discard, run after drafts are reset. */
  onDiscard?: () => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { valuesFor, isChanged, changedRows, originalById, reset, meta } =
    editable;
  const changedCount = changedRows.length;

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    meta,
  });

  // Close the dialog once nothing is left to confirm (successful save or
  // discard). Keeps the open state owned here rather than in every screen.
  useEffect(() => {
    if (changedCount === 0) setConfirmOpen(false);
  }, [changedCount]);

  const handleDiscard = () => {
    reset();
    onDiscard?.();
  };

  return (
    <>
      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <Table>
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
                <TableRow
                  key={row.id}
                  className={cn(
                    isChanged(getRowId(row.original)) && "bg-primary/5",
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="whitespace-nowrap">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
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

      {/* Floating save bar */}
      {changedCount > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
            <span className="text-sm font-medium">
              {changedCount} {itemNoun} changed
            </span>
            <div className="ml-auto flex items-center gap-3">
              {saveBarExtras}
              <Button variant="outline" onClick={handleDiscard}>
                Discard
              </Button>
              <Button onClick={() => setConfirmOpen(true)}>Save changes</Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Confirm changes</DialogTitle>
            <DialogDescription>
              {dialogDescription(changedCount)}
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
            {changedRows.map((row) => {
              const id = getRowId(row);
              const original = originalById.get(id);
              const next = valuesFor(id);
              if (!original) return null;
              const diffs = fields.filter(
                (field) => next[field] !== original[field],
              );
              return (
                <div key={id} className="flex flex-col gap-1">
                  <span className="text-sm font-medium">
                    {getRowLabel(row)}
                  </span>
                  <ul className="flex flex-col gap-0.5 text-sm">
                    {diffs.map((field) => (
                      <li
                        key={String(field)}
                        className="flex items-center gap-1 text-muted-foreground"
                      >
                        <span className="w-32 shrink-0">
                          {fieldLabels[field]}
                        </span>
                        <span className="line-through">
                          {formatValue(field, original[field])}
                        </span>
                        <span aria-hidden>→</span>
                        <span className="font-medium text-foreground">
                          {formatValue(field, next[field])}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              }
            />
            <Button onClick={onSave} loading={isSaving}>
              Confirm &amp; save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
