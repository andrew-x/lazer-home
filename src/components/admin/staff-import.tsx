"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useAction } from "next-safe-action/hooks";
import Papa from "papaparse";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { commitStaffImport } from "@/actions/admin/commitStaffImport";
import { previewStaffImport } from "@/actions/admin/previewStaffImport";
import { DataTable } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  type RawRow,
  type TransformResult,
  transformRows,
} from "@/lib/staff-import/transform";
import type {
  ComparableField,
  ImportUpdate,
  NormalizedStaff,
  SkippedRow,
} from "@/lib/staff-import/types";

const ENUM_LABELS: Record<string, string> = {
  FULL_TIME: "Full-time",
  HOURLY: "Hourly",
};

function formatValue(field: ComparableField, value: unknown): string {
  if (value === null || value === "") return "—";
  if (field === "isActive" || field === "isBillable")
    return value ? "Yes" : "No";
  if (typeof value === "string" && ENUM_LABELS[value])
    return ENUM_LABELS[value];
  return String(value);
}

/** A cell in the updates table: highlights and shows old → new when changed. */
function ChangeCell({
  update,
  field,
}: {
  update: ImportUpdate;
  field: ComparableField;
}) {
  const changed = update.changedFields.includes(field);
  const next = formatValue(field, update.incoming[field]);
  if (!changed) return <span>{next}</span>;
  return (
    <span className="flex items-center gap-1 rounded-sm bg-primary/10 px-1">
      <span className="text-muted-foreground line-through">
        {formatValue(field, update.current[field])}
      </span>
      <span aria-hidden>→</span>
      <span className="font-medium">{next}</span>
    </span>
  );
}

function dashCell({ getValue }: { getValue: () => unknown }) {
  const value = getValue();
  return value == null || value === "" ? "—" : String(value);
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
    cell: ({ getValue }) =>
      ENUM_LABELS[getValue<string>()] ?? getValue<string>(),
  },
  {
    accessorKey: "isBillable",
    header: "Billable",
    cell: ({ getValue }) => (getValue<boolean>() ? "Yes" : "No"),
  },
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
        <ChangeCell update={row.original} field="name" />
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
      cell: ({ row }) => <ChangeCell update={row.original} field={field} />,
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

export function StaffImport() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [transform, setTransform] = useState<TransformResult | null>(null);

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

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setTransform(null);
    preview.reset();
    commit.reset();

    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.trim(),
      complete: (results) => {
        const result = transformRows(results.data);
        setTransform(result);
        preview.execute({ rows: result.rows });
      },
      error: (error) => setParseError(error.message),
    });
  }

  function reset() {
    setFileName(null);
    setParseError(null);
    setTransform(null);
    preview.reset();
    commit.reset();
    // Clear the native input so re-selecting the same file fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const plan = preview.result?.data ?? null;
  const committed = commit.result?.data ?? null;
  const hasImportable = (transform?.rows.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Choose a CSV file</CardTitle>
          <CardDescription>
            A Rippling export with columns: Employee - ID, Employee, Work email,
            Start date, Last day of work, Department, Teams, Title, Employment
            type name.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onFileChange}
            disabled={preview.isExecuting || commit.isExecuting}
            className="cursor-pointer file:cursor-pointer"
          />
          {fileName ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {fileName}
                {transform
                  ? ` — ${transform.rows.length} parsed, ${transform.skipped.length} skipped`
                  : null}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={preview.isExecuting || commit.isExecuting}
              >
                Cancel
              </Button>
            </div>
          ) : null}
          {parseError ? (
            <p className="text-sm text-destructive">{parseError}</p>
          ) : null}
        </CardContent>
      </Card>

      {preview.isExecuting ? (
        <p className="text-sm text-muted-foreground">Analyzing changes…</p>
      ) : null}

      {plan ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">{plan.creates.length} new</Badge>
            <Badge variant="secondary">{plan.updates.length} to update</Badge>
            {plan.unchanged ? (
              <Badge variant="outline">{plan.unchanged} unchanged</Badge>
            ) : null}
            {transform?.skipped.length ? (
              <Badge variant="destructive">
                {transform.skipped.length} skipped
              </Badge>
            ) : null}
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="font-heading text-lg font-semibold">
              New staff ({plan.creates.length})
            </h3>
            <DataTable
              columns={NEW_COLUMNS}
              data={plan.creates}
              emptyMessage="No new staff."
            />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-heading text-lg font-semibold">
              Updates ({plan.updates.length})
            </h3>
            <p className="text-sm text-muted-foreground">
              Changed values are highlighted as <em>old → new</em>. Employment
              changes insert a new effective-dated row.
            </p>
            <DataTable
              columns={UPDATE_COLUMNS}
              data={plan.updates}
              emptyMessage="No updates."
            />
          </section>

          {transform?.skipped.length ? (
            <section className="flex flex-col gap-2">
              <h3 className="font-heading text-lg font-semibold">
                Skipped ({transform.skipped.length})
              </h3>
              <DataTable columns={SKIPPED_COLUMNS} data={transform.skipped} />
            </section>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              onClick={() =>
                transform && commit.execute({ rows: transform.rows })
              }
              loading={commit.isExecuting}
              disabled={!hasImportable || committed !== null}
            >
              {commit.isExecuting
                ? "Saving…"
                : committed
                  ? "Saved"
                  : `Confirm — save ${plan.creates.length + plan.updates.length} records`}
            </Button>
            {committed ? (
              <span className="text-sm text-muted-foreground">
                Created {committed.created}, updated {committed.updated}.
              </span>
            ) : null}
            {commit.result?.serverError ? (
              <span className="text-sm text-destructive">
                {commit.result.serverError}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
