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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { commitBulkEditEmployment } from "@/actions/admin/commitBulkEditEmployment";
import type { StaffEmploymentEditRow } from "@/actions/staff/getStaffEmploymentForEdit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import { Label } from "@/components/ui/label";
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
import { cn } from "@/lib/utils";

const ALL = "ALL";

/** The editable employment facts, kept aligned with the read row's types. */
type EditableValues = Pick<
  StaffEmploymentEditRow,
  | "lineOfBusiness"
  | "role"
  | "employmentType"
  | "isBillable"
  | "utilizationTarget"
  | "billableType"
  | "isManagement"
>;

const FACT_FIELDS = [
  "lineOfBusiness",
  "role",
  "employmentType",
  "isBillable",
  "utilizationTarget",
  "billableType",
  "isManagement",
] as const satisfies readonly (keyof EditableValues)[];

const FIELD_LABELS: Record<keyof EditableValues, string> = {
  lineOfBusiness: "Line of business",
  role: "Role",
  employmentType: "Employment type",
  isBillable: "Billable",
  utilizationTarget: "Utilization",
  billableType: "Billable type",
  isManagement: "Management",
};

type TableMeta = {
  valuesFor: (staffId: string) => EditableValues;
  update: (staffId: string, patch: Partial<EditableValues>) => void;
};

function pickEditable(row: StaffEmploymentEditRow): EditableValues {
  return {
    lineOfBusiness: row.lineOfBusiness,
    role: row.role,
    employmentType: row.employmentType,
    isBillable: row.isBillable,
    utilizationTarget: row.utilizationTarget,
    billableType: row.billableType,
    isManagement: row.isManagement,
  };
}

function formatValue(
  field: keyof EditableValues,
  value: EditableValues[keyof EditableValues],
): string {
  if (field === "isBillable" || field === "isManagement") {
    return value ? "Yes" : "No";
  }
  if (field === "utilizationTarget") return `${value as number}%`;
  if (field === "billableType") {
    return value ? humanizeEnum(value as string) : "None";
  }
  return humanizeEnum(value as string);
}

const clampPercent = (n: number) =>
  Math.max(0, Math.min(100, Number.isFinite(n) ? Math.round(n) : 0));

// --- Cell editors ----------------------------------------------------------

function EnumCell({
  staffId,
  field,
  options,
  table,
  className,
}: {
  staffId: string;
  field: "lineOfBusiness" | "role" | "employmentType";
  options: string[];
  table: TanstackTable<StaffEmploymentEditRow>;
  className?: string;
}) {
  const meta = table.options.meta as TableMeta;
  const value = meta.valuesFor(staffId)[field];
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next)
          meta.update(staffId, { [field]: next } as Partial<EditableValues>);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={FIELD_LABELS[field]}
        className={cn("w-36", className)}
      >
        <SelectValue>
          {(current: string | null) => (current ? humanizeEnum(current) : "")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {humanizeEnum(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SwitchCell({
  staffId,
  field,
  table,
}: {
  staffId: string;
  field: "isBillable" | "isManagement";
  table: TanstackTable<StaffEmploymentEditRow>;
}) {
  const meta = table.options.meta as TableMeta;
  const checked = meta.valuesFor(staffId)[field];
  return (
    <Switch
      checked={checked}
      onCheckedChange={(next) =>
        meta.update(staffId, { [field]: next } as Partial<EditableValues>)
      }
      aria-label={FIELD_LABELS[field]}
    />
  );
}

function UtilizationCell({
  staffId,
  table,
}: {
  staffId: string;
  table: TanstackTable<StaffEmploymentEditRow>;
}) {
  const meta = table.options.meta as TableMeta;
  const values = meta.valuesFor(staffId);
  const disabled = !values.isBillable;
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        min={0}
        max={100}
        step={5}
        value={values.utilizationTarget}
        disabled={disabled}
        aria-label="Utilization target"
        onChange={(event) =>
          meta.update(staffId, {
            utilizationTarget: clampPercent(Number(event.target.value)),
          })
        }
        className="h-8 w-16"
      />
      <div className="flex flex-col leading-none">
        {[0, 50, 100].map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={disabled}
            onClick={() => meta.update(staffId, { utilizationTarget: preset })}
            className="px-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}

function BillableTypeCell({
  staffId,
  options,
  table,
}: {
  staffId: string;
  options: string[];
  table: TanstackTable<StaffEmploymentEditRow>;
}) {
  const meta = table.options.meta as TableMeta;
  const value = meta.valuesFor(staffId).billableType;
  return (
    <ToggleGroup
      variant="outline"
      spacing={0}
      size="sm"
      aria-label="Billable type"
      value={[value]}
      onValueChange={(values) => {
        if (values.length > 0) {
          meta.update(staffId, {
            billableType: values[0] as EditableValues["billableType"],
          });
        }
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option} value={option}>
          {humanizeEnum(option)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// --- Header ----------------------------------------------------------------

function SortHeader({
  column,
  children,
}: {
  column: Column<StaffEmploymentEditRow, unknown>;
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
  options: string[];
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
 * Admin bulk-edit table for staff employment facts. Edits are tracked
 * client-side per staff member; a floating bar surfaces the changed count and a
 * confirmation dialog summarises every field diff before committing. Filtering
 * and sorting are in-memory over the rows fetched once on the server.
 */
export function BulkEditRoles({
  rows,
  lineOfBusinessOptions,
  roleOptions,
  employmentTypeOptions,
  billableTypeOptions,
}: {
  rows: StaffEmploymentEditRow[];
  lineOfBusinessOptions: string[];
  roleOptions: string[];
  employmentTypeOptions: string[];
  billableTypeOptions: string[];
}) {
  const router = useRouter();
  const searchId = useId();

  const [edited, setEdited] = useState<Record<string, EditableValues>>({});
  const [effectiveDate, setEffectiveDate] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "name", desc: false },
  ]);

  // Filters
  const [search, setSearch] = useState("");
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [billable, setBillable] = useState(ALL);
  const [management, setManagement] = useState(ALL);
  const [active, setActive] = useState("true");

  const originalByStaff = useMemo(
    () => new Map(rows.map((r) => [r.staffId, pickEditable(r)])),
    [rows],
  );

  const valuesFor = (staffId: string): EditableValues =>
    edited[staffId] ?? (originalByStaff.get(staffId) as EditableValues);

  const update = (staffId: string, patch: Partial<EditableValues>) => {
    setEdited((prev) => {
      const base =
        prev[staffId] ?? (originalByStaff.get(staffId) as EditableValues);
      const next: EditableValues = { ...base, ...patch };
      // Turning on management makes someone non-billable by default (they can
      // still be flipped back to billable afterward).
      if (patch.isManagement === true) next.isBillable = false;
      // Non-billable rows carry a 0% target (mirrors the import invariant).
      if (!next.isBillable) next.utilizationTarget = 0;
      return { ...prev, [staffId]: next };
    });
  };

  const isChanged = (staffId: string) => {
    const draft = edited[staffId];
    if (!draft) return false;
    const original = originalByStaff.get(staffId);
    if (!original) return false;
    return FACT_FIELDS.some((field) => draft[field] !== original[field]);
  };

  const changedRows = rows.filter((r) => isChanged(r.staffId));

  const commit = useAction(commitBulkEditEmployment, {
    onSuccess: ({ data }) => {
      if (!data) return;
      const verb = data.mode === "insert" ? "Added records for" : "Updated";
      toast.success(`${verb} ${data.staffAffected} staff.`);
      setEdited({});
      setEffectiveDate(null);
      setConfirmOpen(false);
      router.refresh();
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Failed to save changes."),
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (active !== ALL && String(row.isActive) !== active) return false;
      if (query && !row.name.toLowerCase().includes(query)) return false;
      if (lineOfBusiness !== ALL && row.lineOfBusiness !== lineOfBusiness)
        return false;
      if (role !== ALL && row.role !== role) return false;
      if (billable !== ALL && String(row.isBillable) !== billable) return false;
      if (management !== ALL && String(row.isManagement) !== management)
        return false;
      return true;
    });
  }, [rows, search, lineOfBusiness, role, billable, management, active]);

  const columns = useMemo<ColumnDef<StaffEmploymentEditRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortHeader column={column}>Name</SortHeader>,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link
              href={`/staff/${row.original.staffId}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {row.original.name}
            </Link>
            {!row.original.isActive ? (
              <Badge variant="secondary">Inactive</Badge>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "lineOfBusiness",
        header: ({ column }) => (
          <SortHeader column={column}>Line of business</SortHeader>
        ),
        cell: ({ row, table }) => (
          <EnumCell
            staffId={row.original.staffId}
            field="lineOfBusiness"
            options={lineOfBusinessOptions}
            table={table}
            className="w-40"
          />
        ),
      },
      {
        accessorKey: "role",
        header: ({ column }) => <SortHeader column={column}>Role</SortHeader>,
        cell: ({ row, table }) => (
          <EnumCell
            staffId={row.original.staffId}
            field="role"
            options={roleOptions}
            table={table}
          />
        ),
      },
      {
        accessorKey: "employmentType",
        header: ({ column }) => <SortHeader column={column}>Type</SortHeader>,
        cell: ({ row, table }) => (
          <EnumCell
            staffId={row.original.staffId}
            field="employmentType"
            options={employmentTypeOptions}
            table={table}
            className="w-32"
          />
        ),
      },
      {
        accessorKey: "isManagement",
        header: ({ column }) => (
          <SortHeader column={column}>Management</SortHeader>
        ),
        cell: ({ row, table }) => (
          <SwitchCell
            staffId={row.original.staffId}
            field="isManagement"
            table={table}
          />
        ),
      },
      {
        accessorKey: "isBillable",
        header: ({ column }) => (
          <SortHeader column={column}>Billable</SortHeader>
        ),
        cell: ({ row, table }) => (
          <SwitchCell
            staffId={row.original.staffId}
            field="isBillable"
            table={table}
          />
        ),
      },
      {
        accessorKey: "utilizationTarget",
        header: ({ column }) => (
          <SortHeader column={column}>Utilization</SortHeader>
        ),
        cell: ({ row, table }) => (
          <UtilizationCell staffId={row.original.staffId} table={table} />
        ),
      },
      {
        accessorKey: "billableType",
        header: ({ column }) => (
          <SortHeader column={column}>Billable type</SortHeader>
        ),
        cell: ({ row, table }) => (
          <BillableTypeCell
            staffId={row.original.staffId}
            options={billableTypeOptions}
            table={table}
          />
        ),
      },
    ],
    [
      lineOfBusinessOptions,
      roleOptions,
      employmentTypeOptions,
      billableTypeOptions,
    ],
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
    staffId: r.staffId,
    ...valuesFor(r.staffId),
  }));

  return (
    <div className="flex flex-col gap-6 pb-28">
      {/* Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={searchId}>Name</Label>
          <div className="relative max-w-sm">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchId}
              type="search"
              placeholder="Search by name…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-6">
          <SelectFilter
            label="Line of business"
            value={lineOfBusiness}
            options={lineOfBusinessOptions}
            onChange={setLineOfBusiness}
          />
          <SelectFilter
            label="Role"
            value={role}
            options={roleOptions}
            onChange={setRole}
          />
          <TriStateFilter
            label="Billable"
            value={billable}
            onChange={setBillable}
          />
          <TriStateFilter
            label="Management"
            value={management}
            onChange={setManagement}
          />
          <TriStateFilter label="Active" value={active} onChange={setActive} />
        </div>
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
                  className={cn(
                    isChanged(row.original.staffId) && "bg-primary/5",
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
                  No staff match these filters.
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
              {changedRows.length} staff changed
            </span>
            <div className="ml-auto flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Effective date
                </span>
                <DatePicker
                  value={effectiveDate}
                  onChange={setEffectiveDate}
                  placeholder="Update in place"
                />
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setEdited({});
                  setEffectiveDate(null);
                }}
              >
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
              {effectiveDate
                ? `Add a new employment record effective ${effectiveDate} for ${changedRows.length} staff.`
                : `Update the current employment record in place for ${changedRows.length} staff.`}
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
            {changedRows.map((row) => {
              const original = originalByStaff.get(row.staffId);
              const next = valuesFor(row.staffId);
              if (!original) return null;
              const diffs = FACT_FIELDS.filter(
                (field) => next[field] !== original[field],
              );
              return (
                <div key={row.staffId} className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{row.name}</span>
                  <ul className="flex flex-col gap-0.5 text-sm">
                    {diffs.map((field) => (
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
              onClick={() => commit.execute({ effectiveDate, changes })}
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
