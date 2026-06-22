"use client";

import {
  IconChevronDown,
  IconChevronUp,
  IconSearch,
  IconSelector,
} from "@tabler/icons-react";
import {
  type Column,
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  type Table as TanstackTable,
  useReactTable,
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { commitUserChanges } from "@/actions/admin/commitUserChanges";
import type { UserAdminRow } from "@/actions/admin/getUsers";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { humanizeEnum } from "@/lib/format";
import { type AppRole, ROLE_SLUGS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const ALL = "ALL";

/** The two editable RBAC fields, tracked client-side per user. */
type EditableValues = {
  role: AppRole | null;
  banned: boolean;
};

const FIELD_LABELS: Record<keyof EditableValues, string> = {
  role: "Role",
  banned: "Banned",
};

type TableMeta = {
  valuesFor: (userId: string) => EditableValues;
  update: (userId: string, patch: Partial<EditableValues>) => void;
};

function pickEditable(row: UserAdminRow): EditableValues {
  return { role: row.role, banned: row.banned };
}

function formatValue(
  field: keyof EditableValues,
  value: EditableValues[keyof EditableValues],
): string {
  if (field === "banned") return value ? "Yes" : "No";
  return value ? humanizeEnum(value as string) : "—";
}

// --- Cell editors ----------------------------------------------------------

function RoleCell({
  userId,
  table,
}: {
  userId: string;
  table: TanstackTable<UserAdminRow>;
}) {
  const meta = table.options.meta as TableMeta;
  const value = meta.valuesFor(userId).role;
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) meta.update(userId, { role: next as AppRole });
      }}
    >
      <SelectTrigger size="sm" aria-label="Role" className="w-44">
        <SelectValue>
          {(current: string | null) =>
            current ? humanizeEnum(current) : "Set role"
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ROLE_SLUGS.map((option) => (
          <SelectItem key={option} value={option}>
            {humanizeEnum(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BannedCell({
  userId,
  table,
}: {
  userId: string;
  table: TanstackTable<UserAdminRow>;
}) {
  const meta = table.options.meta as TableMeta;
  const checked = meta.valuesFor(userId).banned;
  return (
    <Switch
      checked={checked}
      onCheckedChange={(next) => meta.update(userId, { banned: next })}
      aria-label="Banned"
    />
  );
}

// --- Header ----------------------------------------------------------------

function SortHeader({
  column,
  children,
}: {
  column: Column<UserAdminRow, unknown>;
  children: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(sorted === "asc")}
      className="-mx-1 flex items-center gap-1 rounded-sm px-1 hover:text-foreground"
    >
      {children}
      {sorted === "asc" ? (
        <IconChevronUp className="size-3.5" />
      ) : sorted === "desc" ? (
        <IconChevronDown className="size-3.5" />
      ) : (
        <IconSelector className="size-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

// --- Filters ---------------------------------------------------------------

function FilterLabel({ children }: { children: string }) {
  return (
    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FilterLabel>{label}</FilterLabel>
      <Select value={value} onValueChange={(next) => onChange(next ?? ALL)}>
        <SelectTrigger aria-label={label} className="w-44">
          <SelectValue>
            {(current: string | null) =>
              !current || current === ALL ? "All" : humanizeEnum(current)
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {humanizeEnum(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const TRISTATE = [
  { value: ALL, label: "All" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

function TriStateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FilterLabel>{label}</FilterLabel>
      <ToggleGroup
        variant="outline"
        spacing={0}
        aria-label={label}
        value={[value]}
        onValueChange={(values) => {
          if (values.length > 0) onChange(values[0]);
        }}
      >
        {TRISTATE.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

// --- Main component --------------------------------------------------------

/**
 * Admin table for managing application users' RBAC role and ban status. Edits
 * are tracked client-side per user; a floating bar surfaces the changed count
 * and a confirmation dialog summarises every field diff before committing.
 * Search/filtering/sorting are in-memory over the users fetched once on the
 * server. Mutations go through the Better Auth admin API via `commitUserChanges`.
 */
export function ManageUsers({ users }: { users: UserAdminRow[] }) {
  const router = useRouter();

  const [edited, setEdited] = useState<Record<string, EditableValues>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "name", desc: false },
  ]);

  // Filters
  const [search, setSearch] = useState("");
  const [role, setRole] = useState(ALL);
  const [banned, setBanned] = useState(ALL);

  const originalByUser = useMemo(
    () => new Map(users.map((u) => [u.id, pickEditable(u)])),
    [users],
  );

  const valuesFor = (userId: string): EditableValues =>
    edited[userId] ?? (originalByUser.get(userId) as EditableValues);

  const update = (userId: string, patch: Partial<EditableValues>) => {
    setEdited((prev) => {
      const base =
        prev[userId] ?? (originalByUser.get(userId) as EditableValues);
      return { ...prev, [userId]: { ...base, ...patch } };
    });
  };

  const isChanged = (userId: string) => {
    const draft = edited[userId];
    if (!draft) return false;
    const original = originalByUser.get(userId);
    if (!original) return false;
    return draft.role !== original.role || draft.banned !== original.banned;
  };

  const changedRows = users.filter((u) => isChanged(u.id));

  const commit = useAction(commitUserChanges, {
    onSuccess: ({ data }) => {
      if (!data) return;
      toast.success(`Updated ${data.usersAffected} users.`);
      setEdited({});
      setConfirmOpen(false);
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Failed to save changes."),
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((row) => {
      if (
        query &&
        !row.name.toLowerCase().includes(query) &&
        !row.email.toLowerCase().includes(query)
      )
        return false;
      if (role !== ALL && row.role !== role) return false;
      if (banned !== ALL && String(row.banned) !== banned) return false;
      return true;
    });
  }, [users, search, role, banned]);

  const columns = useMemo<ColumnDef<UserAdminRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortHeader column={column}>Name</SortHeader>,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">
              {row.original.email}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: ({ column }) => <SortHeader column={column}>Role</SortHeader>,
        cell: ({ row, table }) => (
          <RoleCell userId={row.original.id} table={table} />
        ),
      },
      {
        accessorKey: "banned",
        header: ({ column }) => <SortHeader column={column}>Banned</SortHeader>,
        cell: ({ row, table }) => (
          <BannedCell userId={row.original.id} table={table} />
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    meta: { valuesFor, update } satisfies TableMeta,
  });

  const changes = changedRows.map((r) => ({
    userId: r.id,
    ...valuesFor(r.id),
  }));

  return (
    <div className="flex flex-col gap-6 pb-28">
      {/* Filters — all on one line */}
      <div className="flex flex-wrap items-end gap-6">
        <div className="flex flex-col gap-1.5">
          <FilterLabel>Search</FilterLabel>
          <div className="relative w-64">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search"
              placeholder="Search by name or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <SelectFilter
          label="Role"
          value={role}
          options={ROLE_SLUGS}
          onChange={setRole}
        />
        <TriStateFilter label="Banned" value={banned} onChange={setBanned} />
      </div>

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
                  className={cn(isChanged(row.original.id) && "bg-primary/5")}
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
                  No users match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Floating save bar */}
      {changedRows.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
            <span className="text-sm font-medium">
              {changedRows.length} users changed
            </span>
            <div className="ml-auto flex items-center gap-3">
              <Button variant="outline" onClick={() => setEdited({})}>
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
              {`Update role and ban status for ${changedRows.length} users.`}
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
            {changedRows.map((row) => {
              const original = originalByUser.get(row.id);
              const next = valuesFor(row.id);
              if (!original) return null;
              const fields = (
                [
                  "role",
                  "banned",
                ] as const satisfies readonly (keyof EditableValues)[]
              ).filter((field) => next[field] !== original[field]);
              return (
                <div key={row.id} className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{row.name}</span>
                  <ul className="flex flex-col gap-0.5 text-sm">
                    {fields.map((field) => (
                      <li
                        key={field}
                        className="flex items-center gap-1 text-muted-foreground"
                      >
                        <span className="w-32 shrink-0">
                          {FIELD_LABELS[field]}
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
            <Button
              onClick={() => commit.execute({ changes })}
              loading={commit.isExecuting}
            >
              Confirm &amp; save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
