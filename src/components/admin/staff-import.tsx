"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { commitStaffImport } from "@/actions/admin/commitStaffImport";
import { previewStaffImport } from "@/actions/admin/previewStaffImport";
import {
  ChangeCell,
  CsvImport,
  type CsvPlanBadge,
  csvPreviewSection,
} from "@/components/admin/csv-import";
import { Badge } from "@/components/ui/badge";
import { humanizeEnum } from "@/lib/format";
import { transformRows } from "@/lib/staff-import/transform";
import type {
  ComparableField,
  ImportUpdate,
  NormalizedStaff,
  SkippedRow,
  StaffImportPlan,
} from "@/lib/staff-import/types";

const MONEY_FIELDS = new Set<ComparableField>([
  "base",
  "hourlyRate",
  "guaranteedBonus",
  "discretionaryBonus",
]);

function formatValue(field: ComparableField, value: unknown): string {
  if (value === null || value === "") return "—";
  if (field === "isActive" || field === "isBillable")
    return value ? "Yes" : "No";
  if (field === "employmentType" && typeof value === "string")
    return humanizeEnum(value);
  if (MONEY_FIELDS.has(field) && typeof value === "number")
    return new Intl.NumberFormat().format(value);
  return String(value);
}

function dashCell({ getValue }: { getValue: () => unknown }) {
  const value = getValue();
  return value == null || value === "" ? "—" : String(value);
}

function moneyCell({ getValue }: { getValue: () => unknown }) {
  const value = getValue();
  return typeof value === "number"
    ? new Intl.NumberFormat().format(value)
    : "—";
}

const NEW_COLUMNS: ColumnDef<NormalizedStaff>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "email", header: "Email" },
  { accessorKey: "ripplingId", header: "Rippling ID" },
  { accessorKey: "role", header: "Role" },
  { accessorKey: "lineOfBusiness", header: "Line of business" },
  {
    accessorKey: "employmentType",
    header: "Type",
    cell: ({ getValue }) => humanizeEnum(getValue<string>()),
  },
  {
    accessorKey: "isBillable",
    header: "Billable",
    cell: ({ getValue }) => (getValue<boolean>() ? "Yes" : "No"),
  },
  { accessorKey: "base", header: "Base", cell: moneyCell },
  { accessorKey: "hourlyRate", header: "Hourly rate", cell: moneyCell },
  {
    accessorKey: "guaranteedBonus",
    header: "Guaranteed bonus",
    cell: moneyCell,
  },
  { accessorKey: "currency", header: "Currency", cell: dashCell },
  { accessorKey: "joinDate", header: "Join date", cell: dashCell },
  {
    accessorKey: "terminationDate",
    header: "Termination",
    cell: dashCell,
  },
];

const UPDATE_FIELDS: { field: ComparableField; header: string }[] = [
  { field: "email", header: "Email" },
  { field: "role", header: "Role" },
  { field: "lineOfBusiness", header: "Line of business" },
  { field: "employmentType", header: "Type" },
  { field: "isBillable", header: "Billable" },
  { field: "base", header: "Base" },
  { field: "hourlyRate", header: "Hourly rate" },
  { field: "guaranteedBonus", header: "Guaranteed bonus" },
  { field: "currency", header: "Currency" },
  { field: "joinDate", header: "Join date" },
  { field: "terminationDate", header: "Termination" },
  { field: "isActive", header: "Active" },
];

const UPDATE_COLUMNS: ColumnDef<ImportUpdate>[] = [
  {
    id: "name",
    header: "Name",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <ChangeCell update={row.original} field="name" format={formatValue} />
        {row.original.employmentChanged ? (
          <Badge variant="secondary" className="font-normal">
            new employment row
          </Badge>
        ) : null}
      </div>
    ),
  },
  ...UPDATE_FIELDS.map(
    ({ field, header }): ColumnDef<ImportUpdate> => ({
      id: field,
      header,
      cell: ({ row }) => (
        <ChangeCell update={row.original} field={field} format={formatValue} />
      ),
    }),
  ),
];

const SKIPPED_COLUMNS: ColumnDef<SkippedRow>[] = [
  { accessorKey: "rowNumber", header: "Row" },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "ripplingId", header: "Rippling ID", cell: dashCell },
  {
    accessorKey: "reason",
    header: "Reason",
    cell: ({ getValue }) => (
      <span className="text-destructive">{getValue<string>()}</span>
    ),
  },
];

const PLAN_BADGES: CsvPlanBadge<StaffImportPlan>[] = [
  { label: (p) => `${p.creates.length} new`, variant: "secondary" },
  { label: (p) => `${p.updates.length} to update`, variant: "secondary" },
  {
    label: (p) => `${p.unchanged} unchanged`,
    variant: "outline",
    show: (p) => p.unchanged > 0,
  },
];

const SECTIONS = [
  csvPreviewSection<StaffImportPlan, NormalizedStaff>({
    title: (p) => `New staff (${p.creates.length})`,
    data: (p) => p.creates,
    columns: NEW_COLUMNS,
    emptyMessage: "No new staff.",
  }),
  csvPreviewSection<StaffImportPlan, ImportUpdate>({
    title: (p) => `Updates (${p.updates.length})`,
    description: (
      <>
        Changed values are highlighted as <em>old → new</em>. Employment changes
        insert a new effective-dated row.
      </>
    ),
    data: (p) => p.updates,
    columns: UPDATE_COLUMNS,
    emptyMessage: "No updates.",
  }),
];

export function StaffImport() {
  const preview = useAction(previewStaffImport, {
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Failed to analyze the file."),
  });
  const commit = useAction(commitStaffImport, {
    onSuccess: ({ data }) => {
      if (!data) return;
      toast.success(
        `Saved ${data.created} new and ${data.updated} updated staff (${data.employmentRowsAdded} employment rows).`,
      );
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Failed to save the import."),
  });

  return (
    <CsvImport
      transformRows={transformRows}
      preview={preview}
      commit={commit}
      fileCard={{
        title: "1. Choose a CSV file",
        description:
          "A Rippling export with columns: Employee - ID, Employee, Work email, Start date, Last day of work, Department, Teams, Title, Employment type name, Annual base remuneration, Hourly Rate, Target annual bonus, Compensation currency.",
      }}
      planBadges={PLAN_BADGES}
      sections={SECTIONS}
      skippedColumns={SKIPPED_COLUMNS}
      confirmLabel={(plan) =>
        `Confirm — save ${plan.creates.length + plan.updates.length} records`
      }
      canCommit={(_plan, transform) => transform.rows.length > 0}
      committedSummary={(data) =>
        `Created ${data.created}, updated ${data.updated}.`
      }
    />
  );
}
