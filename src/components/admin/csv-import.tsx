"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Papa from "papaparse";
import { type ReactNode, useRef, useState } from "react";
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
import type { RawRow, SkippedRow, TransformResult } from "@/lib/csv-import";

/**
 * Shared file → preview → commit harness for the admin CSV imports. Owns the
 * PapaParse config, file/reset lifecycle, badge summary, section rendering and
 * commit orchestration; each page supplies only its columns, labels and the
 * two next-safe-action hooks (which carry the page-specific success toasts).
 */

/** The subset of `useAction`'s return object the harness consumes. */
type ImportActionHook<TInput, TData> = {
  isExecuting: boolean;
  execute: (input: TInput) => void;
  reset: () => void;
  result: { data?: TData; serverError?: string };
};

/** A summary badge derived from the preview plan. */
export type CsvPlanBadge<TPlan> = {
  label: (plan: TPlan) => string;
  variant: "secondary" | "outline" | "destructive";
  /** When omitted the badge always shows. */
  show?: (plan: TPlan) => boolean;
};

/** A rendered preview section; built with {@link csvPreviewSection}. */
export type CsvPreviewSection<TPlan> = (plan: TPlan) => ReactNode;

/**
 * A cell in an updates table: shows the incoming value, and when the field
 * changed highlights it as `old → new`. Generic over the comparable-field union
 * so it works for any import's update shape.
 */
export function ChangeCell<F extends string>({
  update,
  field,
  format,
}: {
  update: {
    changedFields: readonly F[];
    incoming: Record<F, unknown>;
    current: Record<F, unknown>;
  };
  field: F;
  format: (field: F, value: unknown) => string;
}) {
  const changed = update.changedFields.includes(field);
  const next = format(field, update.incoming[field]);
  if (!changed) return <span>{next}</span>;
  return (
    <span className="flex items-center gap-1 rounded-sm bg-primary/10 px-1">
      <span className="text-muted-foreground line-through">
        {format(field, update.current[field])}
      </span>
      <span aria-hidden>→</span>
      <span className="font-medium">{next}</span>
    </span>
  );
}

/**
 * Declare a preview section. Ties `data` and `columns` to the same row type so
 * the harness can hold a heterogeneous list of sections without losing type
 * safety at the call site.
 */
export function csvPreviewSection<TPlan, R>(config: {
  title: (plan: TPlan) => string;
  description?: ReactNode;
  data: (plan: TPlan) => R[];
  columns: ColumnDef<R>[];
  emptyMessage?: string;
  /** When omitted the section always shows. */
  show?: (plan: TPlan) => boolean;
}): CsvPreviewSection<TPlan> {
  return function Section(plan: TPlan) {
    if (config.show && !config.show(plan)) return null;
    return (
      <section className="flex flex-col gap-2">
        <h3 className="font-heading text-lg font-semibold">
          {config.title(plan)}
        </h3>
        {config.description ? (
          <p className="text-sm text-muted-foreground">{config.description}</p>
        ) : null}
        <DataTable
          columns={config.columns}
          data={config.data(plan)}
          emptyMessage={config.emptyMessage}
        />
      </section>
    );
  };
}

type CsvImportProps<TRow, TPlan, TCommit> = {
  /** Pure CSV → normalized-rows transform (runs client-side after parse). */
  transformRows: (rows: RawRow[]) => TransformResult<TRow>;
  preview: ImportActionHook<{ rows: TRow[] }, TPlan>;
  commit: ImportActionHook<{ rows: TRow[] }, TCommit>;
  fileCard: { title: ReactNode; description: ReactNode };
  planBadges: CsvPlanBadge<TPlan>[];
  sections: CsvPreviewSection<TPlan>[];
  skippedColumns: ColumnDef<SkippedRow>[];
  /** Idle label for the commit button (e.g. "Confirm — save 4 records"). */
  confirmLabel: (plan: TPlan, transform: TransformResult<TRow>) => string;
  /** Whether the commit button is enabled for this plan. */
  canCommit: (plan: TPlan, transform: TransformResult<TRow>) => boolean;
  /** Inline summary shown after a successful commit. */
  committedSummary: (data: TCommit) => ReactNode;
};

export function CsvImport<TRow, TPlan, TCommit>({
  transformRows,
  preview,
  commit,
  fileCard,
  planBadges,
  sections,
  skippedColumns,
  confirmLabel,
  canCommit,
  committedSummary,
}: CsvImportProps<TRow, TPlan, TCommit>) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [transform, setTransform] = useState<TransformResult<TRow> | null>(
    null,
  );

  const busy = preview.isExecuting || commit.isExecuting;

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

  const plan = preview.result.data ?? null;
  const committed = commit.result.data ?? null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{fileCard.title}</CardTitle>
          <CardDescription>{fileCard.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onFileChange}
            disabled={busy}
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
              <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
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

      {preview.result.serverError ? (
        <p className="text-sm text-destructive">{preview.result.serverError}</p>
      ) : null}

      {plan ? (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {planBadges.map((badge) =>
              badge.show && !badge.show(plan) ? null : (
                <Badge key={badge.label(plan)} variant={badge.variant}>
                  {badge.label(plan)}
                </Badge>
              ),
            )}
            {transform?.skipped.length ? (
              <Badge variant="destructive">
                {transform.skipped.length} skipped
              </Badge>
            ) : null}
          </div>

          {sections.map((section, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: sections are a static, ordered config.
            <div key={index}>{section(plan)}</div>
          ))}

          {transform?.skipped.length ? (
            <section className="flex flex-col gap-2">
              <h3 className="font-heading text-lg font-semibold">
                Skipped ({transform.skipped.length})
              </h3>
              <DataTable columns={skippedColumns} data={transform.skipped} />
            </section>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              onClick={() =>
                transform && commit.execute({ rows: transform.rows })
              }
              loading={commit.isExecuting}
              disabled={
                !transform || !canCommit(plan, transform) || committed !== null
              }
            >
              {commit.isExecuting
                ? "Saving…"
                : committed
                  ? "Saved"
                  : transform
                    ? confirmLabel(plan, transform)
                    : ""}
            </Button>
            {committed ? (
              <span className="text-sm text-muted-foreground">
                {committedSummary(committed)}
              </span>
            ) : null}
            {commit.result.serverError ? (
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
