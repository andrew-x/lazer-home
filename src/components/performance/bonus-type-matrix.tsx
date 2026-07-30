"use client";

import { useMemo, useState } from "react";
import { FilterLabel } from "@/components/form/filters";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { computeBonusMatrix } from "@/lib/performance/bonus-stats";
import { BONUS_TYPE_LABELS, BONUS_TYPES } from "@/lib/staff/staff-bonus";

/** One payment, already normalized to the display currency. */
export type BonusMatrixPayment = {
  recipientKey: string;
  lineOfBusiness: string;
  role: string;
  type: string;
  amount: number;
};

/** A dimension bonus type can be crossed with, i.e. one down the side. */
export type MatrixAxis = {
  key: "lineOfBusiness" | "role";
  heading: string;
  /** The order rows appear in — the enum's order, not the data's. */
  order: readonly string[];
  labels: Record<string, string>;
};

const TYPE_LABELS: Record<string, string> = BONUS_TYPE_LABELS;

/**
 * Bonus **type crossed with a second dimension**: how each line of business's (or
 * each role's) spend splits across the kinds of bonus — the question the three
 * single-axis tables above it can't answer, since a discretionary-heavy team and a
 * spot-heavy one look identical by total alone.
 *
 * Two deliberate limits:
 *
 *  - **Money only.** Recipient counts are distinct counts, so one person paid a
 *    spot *and* a signing bonus is a single recipient in two cells and still one in
 *    the margin. Per-cell counts would therefore look like an arithmetic error;
 *    the single-axis tables remain the place to count people.
 *  - **Nothing renders below two type columns** — with one type in play (the type
 *    filter is set, or a thin year) every cell just repeats the axis table's Total.
 *
 * Payments arrive already converted to the display currency: FX lives with the rest
 * of the aggregation in `bonus-breakdown.tsx`, so every figure on the page is
 * normalized exactly once.
 */
export function BonusTypeMatrix({
  payments,
  axes,
  money,
}: {
  payments: readonly BonusMatrixPayment[];
  axes: readonly MatrixAxis[];
  /** `aggregateMoneyFormatters(currency).money` — renders `null` as an em dash. */
  money: (value: number | null) => string;
}) {
  const [axisKey, setAxisKey] = useState<MatrixAxis["key"]>(axes[0].key);
  const axis = axes.find((a) => a.key === axisKey) ?? axes[0];

  const matrix = useMemo(
    () =>
      computeBonusMatrix(
        payments.map((p) => ({
          recipientKey: p.recipientKey,
          row: p[axis.key],
          col: p.type,
          amount: p.amount,
        })),
        axis.order,
        BONUS_TYPES,
      ),
    [payments, axis],
  );

  if (matrix.columns.length < 2) return null;

  return (
    <div className="rounded border">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b px-4 py-3">
        <h3 className="font-medium">
          Bonus type by {axis.heading.toLowerCase()}
        </h3>
        <div className="flex min-w-0 flex-col gap-1.5">
          <FilterLabel>Break down by</FilterLabel>
          <div className="max-w-full overflow-x-auto">
            <ToggleGroup
              variant="outline"
              spacing={0}
              aria-label="Cross-cut dimension"
              value={[axisKey]}
              // Single-select: ignore the empty array Base UI emits when the
              // active segment is pressed again.
              onValueChange={(values) => {
                const next = axes.find((a) => a.key === values[0]);
                if (next) setAxisKey(next.key);
              }}
            >
              {axes.map((a) => (
                <ToggleGroupItem key={a.key} value={a.key}>
                  {a.heading}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      </div>

      {/* A type per column plus the margin is wide: scroll the table, not the page. */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{axis.heading}</TableHead>
              {matrix.columns.map((col) => (
                <TableHead key={col} className="text-right">
                  {TYPE_LABELS[col] ?? col}
                </TableHead>
              ))}
              <TableHead className="text-right">All</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matrix.rows.map(({ row, cells, total }) => (
              <TableRow key={row}>
                <TableCell className="font-medium">
                  {axis.labels[row] ?? row}
                </TableCell>
                {cells.map((stats, index) => (
                  <TableCell
                    key={matrix.columns[index]}
                    className="text-right tabular-nums"
                  >
                    {money(stats?.total ?? null)}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium tabular-nums">
                  {money(total.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>All</TableCell>
              {matrix.columnTotals.map((stats, index) => (
                <TableCell
                  key={matrix.columns[index]}
                  className="text-right tabular-nums"
                >
                  {money(stats.total)}
                </TableCell>
              ))}
              <TableCell className="text-right tabular-nums">
                {money(matrix.overall.total)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        Total paid — cells sum across to each row's total and down to the totals
        row. Amounts only: the same person can appear in more than one type, so
        counting recipients per cell wouldn't add up. A dash means nothing of
        that type was paid.
      </p>
    </div>
  );
}
