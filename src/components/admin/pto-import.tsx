"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { commitPtoImport } from "@/actions/admin/commitPtoImport";
import { previewPtoImport } from "@/actions/admin/previewPtoImport";
import {
  ChangeCell,
  CsvImport,
  type CsvPlanBadge,
  csvPreviewSection,
} from "@/components/admin/csv-import";
import { transformRows } from "@/lib/pto-import/transform";
import type {
  ComparableField,
  NormalizedPto,
  PtoDeletion,
  PtoImportPlan,
  PtoImportUpdate,
  SkippedRow,
} from "@/lib/pto-import/types";
import { PTO_TYPE_LABELS, type PtoType } from "@/lib/staff-enums";

function formatValue(field: ComparableField, value: unknown): string {
  if (value === null || value === "") return "—";
  if (field === "isPending") return value ? "Pending" : "Approved";
  if (field === "type" && typeof value === "string")
    return PTO_TYPE_LABELS[value as PtoType];
  return String(value);
}

const NEW_COLUMNS: ColumnDef<NormalizedPto>[] = [
  { accessorKey: "name", header: "Employee" },
  { accessorKey: "staffRipplingId", header: "Employee ID" },
  { accessorKey: "ripplingId", header: "Leave request ID" },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ getValue }) => PTO_TYPE_LABELS[getValue<PtoType>()],
  },
  { accessorKey: "startDate", header: "Start" },
  { accessorKey: "endDate", header: "End" },
  {
    accessorKey: "isPending",
    header: "Status",
    cell: ({ getValue }) => (getValue<boolean>() ? "Pending" : "Approved"),
  },
];

const UPDATE_FIELDS: { field: ComparableField; header: string }[] = [
  { field: "startDate", header: "Start" },
  { field: "endDate", header: "End" },
  { field: "type", header: "Type" },
  { field: "isPending", header: "Status" },
];

const UPDATE_COLUMNS: ColumnDef<PtoImportUpdate>[] = [
  {
    id: "name",
    header: "Employee",
    cell: ({ row }) => row.original.incoming.name || "—",
  },
  {
    id: "ripplingId",
    header: "Leave request ID",
    cell: ({ row }) => row.original.incoming.ripplingId,
  },
  ...UPDATE_FIELDS.map(
    ({ field, header }): ColumnDef<PtoImportUpdate> => ({
      id: field,
      header,
      cell: ({ row }) => (
        <ChangeCell update={row.original} field={field} format={formatValue} />
      ),
    }),
  ),
];

const DELETE_COLUMNS: ColumnDef<PtoDeletion>[] = [
  { accessorKey: "staffName", header: "Employee" },
  { accessorKey: "ripplingId", header: "Leave request ID" },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ getValue }) => PTO_TYPE_LABELS[getValue<PtoType>()],
  },
  { accessorKey: "startDate", header: "Start" },
  { accessorKey: "endDate", header: "End" },
];

const SKIPPED_COLUMNS: ColumnDef<SkippedRow>[] = [
  { accessorKey: "name", header: "Employee" },
  { accessorKey: "ripplingId", header: "Leave request ID" },
  {
    accessorKey: "reason",
    header: "Reason",
    cell: ({ getValue }) => (
      <span className="text-destructive">{getValue<string>()}</span>
    ),
  },
];

const PLAN_BADGES: CsvPlanBadge<PtoImportPlan>[] = [
  { label: (p) => `${p.creates.length} new`, variant: "secondary" },
  { label: (p) => `${p.updates.length} to update`, variant: "secondary" },
  { label: (p) => `${p.deletes.length} to delete`, variant: "secondary" },
  {
    label: (p) => `${p.unchanged} unchanged`,
    variant: "outline",
    show: (p) => p.unchanged > 0,
  },
  {
    label: (p) => `${p.ignoredCancellations} ignored cancellations`,
    variant: "outline",
    show: (p) => p.ignoredCancellations > 0,
  },
];

const SECTIONS = [
  csvPreviewSection<PtoImportPlan, NormalizedPto>({
    title: (p) => `New PTO (${p.creates.length})`,
    data: (p) => p.creates,
    columns: NEW_COLUMNS,
    emptyMessage: "No new PTO records.",
  }),
  csvPreviewSection<PtoImportPlan, PtoImportUpdate>({
    title: (p) => `Updates (${p.updates.length})`,
    description: (
      <>
        Changed values are highlighted as <em>old → new</em>.
      </>
    ),
    data: (p) => p.updates,
    columns: UPDATE_COLUMNS,
    emptyMessage: "No updates.",
  }),
  csvPreviewSection<PtoImportPlan, PtoDeletion>({
    title: (p) => `To delete (${p.deletes.length})`,
    description:
      "Rejected or cancelled requests — these records will be removed.",
    data: (p) => p.deletes,
    columns: DELETE_COLUMNS,
    show: (p) => p.deletes.length > 0,
  }),
];

const writeCount = (p: PtoImportPlan) =>
  p.creates.length + p.updates.length + p.deletes.length;

export function PtoImport() {
  const preview = useAction(previewPtoImport, {
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Failed to analyze the file."),
  });
  const commit = useAction(commitPtoImport, {
    onSuccess: ({ data }) => {
      if (!data) return;
      toast.success(
        `Saved ${data.created} new, ${data.updated} updated, ${data.deleted} removed PTO records.`,
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
          "A Rippling leave export with columns: Leave request ID, Employee - ID, Employee, Start date, Leave end date, Leave request status, Leave policy custom name.",
      }}
      planBadges={PLAN_BADGES}
      sections={SECTIONS}
      skippedColumns={SKIPPED_COLUMNS}
      confirmLabel={(plan) => {
        const count = writeCount(plan);
        return `Confirm — apply ${count} change${count === 1 ? "" : "s"}`;
      }}
      canCommit={(plan) => writeCount(plan) > 0}
      committedSummary={(data) =>
        `Created ${data.created}, updated ${data.updated}, deleted ${data.deleted}.`
      }
    />
  );
}
