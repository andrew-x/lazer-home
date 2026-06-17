"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useAction } from "next-safe-action/hooks";
import Papa from "papaparse";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { commitPtoImport } from "@/actions/admin/commitPtoImport";
import { previewPtoImport } from "@/actions/admin/previewPtoImport";
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
} from "@/lib/pto-import/transform";
import type {
  ComparableField,
  NormalizedPto,
  PtoDeletion,
  PtoImportUpdate,
  SkippedRow,
} from "@/lib/pto-import/types";

const TYPE_LABELS: Record<string, string> = {
  VACATION: "Vacation",
  STATUTORY_HOLIDAY: "Statutory holiday",
  SICK_LEAVE: "Sick leave",
  UNPAID_LEAVE: "Unpaid leave",
  PARENTAL_LEAVE: "Parental leave",
  BEREAVEMENT_LEAVE: "Bereavement leave",
  COMPANY_RETREAT: "Company retreat",
  RELIGIOUS_HOLIDAY: "Religious holiday",
  JURY_DUTY: "Jury duty",
  LEAVE_OF_ABSENCE: "Leave of absence",
  OTHER_LEAVE: "Other leave",
};

function formatValue(field: ComparableField, value: unknown): string {
  if (value === null || value === "") return "—";
  if (field === "isPending") return value ? "Pending" : "Approved";
  if (field === "type" && typeof value === "string")
    return TYPE_LABELS[value] ?? value;
  return String(value);
}

/** A cell in the updates table: highlights and shows old → new when changed. */
function ChangeCell({
  update,
  field,
}: {
  update: PtoImportUpdate;
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

const formatType = (value: string) => TYPE_LABELS[value] ?? value;

const NEW_COLUMNS: ColumnDef<NormalizedPto>[] = [
  { accessorKey: "name", header: "Employee" },
  { accessorKey: "staffRipplingId", header: "Employee ID" },
  { accessorKey: "ripplingId", header: "Leave request ID" },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ getValue }) => formatType(getValue<string>()),
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
      cell: ({ row }) => <ChangeCell update={row.original} field={field} />,
    }),
  ),
];

const DELETE_COLUMNS: ColumnDef<PtoDeletion>[] = [
  { accessorKey: "staffName", header: "Employee" },
  { accessorKey: "ripplingId", header: "Leave request ID" },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ getValue }) => formatType(getValue<string>()),
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

export function PtoImport() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [transform, setTransform] = useState<TransformResult | null>(null);

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
  const writeCount = plan
    ? plan.creates.length + plan.updates.length + plan.deletes.length
    : 0;
  const hasWork = writeCount > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Choose a CSV file</CardTitle>
          <CardDescription>
            A Rippling leave export with columns: Leave request ID, Employee -
            ID, Employee, Start date, Leave end date, Leave request status,
            Leave policy custom name.
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
            <Badge variant="secondary">{plan.deletes.length} to delete</Badge>
            {plan.unchanged ? (
              <Badge variant="outline">{plan.unchanged} unchanged</Badge>
            ) : null}
            {plan.ignoredCancellations ? (
              <Badge variant="outline">
                {plan.ignoredCancellations} ignored cancellations
              </Badge>
            ) : null}
            {transform?.skipped.length ? (
              <Badge variant="destructive">
                {transform.skipped.length} skipped
              </Badge>
            ) : null}
          </div>

          <section className="flex flex-col gap-2">
            <h3 className="font-heading text-lg font-semibold">
              New PTO ({plan.creates.length})
            </h3>
            <DataTable
              columns={NEW_COLUMNS}
              data={plan.creates}
              emptyMessage="No new PTO records."
            />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-heading text-lg font-semibold">
              Updates ({plan.updates.length})
            </h3>
            <p className="text-sm text-muted-foreground">
              Changed values are highlighted as <em>old → new</em>.
            </p>
            <DataTable
              columns={UPDATE_COLUMNS}
              data={plan.updates}
              emptyMessage="No updates."
            />
          </section>

          {plan.deletes.length ? (
            <section className="flex flex-col gap-2">
              <h3 className="font-heading text-lg font-semibold">
                To delete ({plan.deletes.length})
              </h3>
              <p className="text-sm text-muted-foreground">
                Rejected or cancelled requests — these records will be removed.
              </p>
              <DataTable columns={DELETE_COLUMNS} data={plan.deletes} />
            </section>
          ) : null}

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
              disabled={!hasWork || committed !== null}
            >
              {commit.isExecuting
                ? "Saving…"
                : committed
                  ? "Saved"
                  : `Confirm — apply ${writeCount} change${writeCount === 1 ? "" : "s"}`}
            </Button>
            {committed ? (
              <span className="text-sm text-muted-foreground">
                Created {committed.created}, updated {committed.updated},
                deleted {committed.deleted}.
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
