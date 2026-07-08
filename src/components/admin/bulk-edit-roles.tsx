"use client";

import { IconSearch } from "@tabler/icons-react";
import type {
  ColumnDef,
  SortingState,
  Table as TanstackTable,
} from "@tanstack/react-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FACT_FIELDS,
  type FactField,
} from "@/actions/admin/bulkEditEmployment.schema";
import { commitBulkEditEmployment } from "@/actions/admin/commitBulkEditEmployment";
import type { StaffEmploymentEditRow } from "@/actions/staff/getStaffEmploymentForEdit";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { humanizeEnum } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  EditableTable,
  type EditableTableMeta,
  useEditableRows,
} from "./editable-table";
import { ALL, SelectFilter, SortHeader, TriStateFilter } from "./table-filters";

/**
 * The editable employment facts, kept aligned with the read row's types. Keyed
 * by {@link FactField} so the field list stays in lockstep with the schema.
 */
type EditableValues = Pick<StaffEmploymentEditRow, FactField>;

const FIELD_LABELS: Record<keyof EditableValues, string> = {
  lineOfBusiness: "Line of business",
  role: "Role",
  employmentType: "Employment type",
  isBillable: "Billable",
  utilizationTarget: "Utilization",
  billableType: "Billable type",
  isManagement: "Management",
};

type TableMeta = EditableTableMeta<EditableValues>;

const getStaffId = (row: StaffEmploymentEditRow) => row.staffId;

/** Merge a patch, enforcing the billable/management/utilization invariants. */
function applyEmploymentPatch(
  base: EditableValues,
  patch: Partial<EditableValues>,
): EditableValues {
  const next: EditableValues = { ...base, ...patch };
  // Turning on management makes someone non-billable by default (they can still
  // be flipped back to billable afterward).
  if (patch.isManagement === true) next.isBillable = false;
  // Non-billable rows carry a 0% target (mirrors the import invariant).
  if (!next.isBillable) next.utilizationTarget = 0;
  return next;
}

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

  const [effectiveDate, setEffectiveDate] = useState<string | null>(null);
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

  const editable = useEditableRows<StaffEmploymentEditRow, EditableValues>({
    rows,
    getRowId: getStaffId,
    getEditableValues: pickEditable,
    fields: FACT_FIELDS,
    applyPatch: applyEmploymentPatch,
  });

  const commit = useAction(commitBulkEditEmployment, {
    onSuccess: ({ data }) => {
      if (!data) return;
      const verb = data.mode === "insert" ? "Added records for" : "Updated";
      toast.success(`${verb} ${data.staffAffected} staff.`);
      editable.reset();
      setEffectiveDate(null);
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

  const changes = editable.changedRows.map((r) => ({
    staffId: r.staffId,
    ...editable.valuesFor(r.staffId),
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

      <EditableTable
        editable={editable}
        rows={filtered}
        columns={columns}
        sorting={sorting}
        onSortingChange={setSorting}
        getRowId={getStaffId}
        getRowLabel={(row) => row.name}
        emptyMessage="No staff match these filters."
        fields={FACT_FIELDS}
        fieldLabels={FIELD_LABELS}
        formatValue={formatValue}
        itemNoun="staff"
        dialogDescription={(count) =>
          effectiveDate
            ? `Add a new employment record effective ${effectiveDate} for ${count} staff.`
            : `Update the current employment record in place for ${count} staff.`
        }
        saveBarExtras={
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
        }
        onDiscard={() => setEffectiveDate(null)}
        onSave={() => commit.execute({ effectiveDate, changes })}
        isSaving={commit.isExecuting}
      />
    </div>
  );
}
