"use client";

import { useState } from "react";
import { SegmentedFilter } from "@/components/form/filters";
import { ROOMY_TABLE } from "@/components/table-density";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/core/utils";
import {
  formatPercent,
  formatShortDate,
  parseIsoDate,
} from "@/lib/format/format";
import type { RoleStaffing, StaffingModel } from "@/lib/home/org-status";
import {
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
  type EmploymentType,
  ROLE_LABELS,
} from "@/lib/staff/staff-enums";

const ROLE_ROW_LABELS: Record<RoleStaffing["role"], string> = {
  ...ROLE_LABELS,
  OTHER: "Other",
};

/**
 * How much of the bench is working, **right now**.
 *
 * This replaced a year-to-date, timesheet-driven table. Three deliberate changes:
 *
 * - **Point in time, not cumulative.** The header states the date rather than a
 *   range, because that is what the figures describe. Sitting opposite Your
 *   Status's year-to-date tiles, an unlabelled "Utilization" here would be read as
 *   the same kind of number; it isn't, so the word never appears alone.
 * - **From the plan, not from timesheets.** Counting confirmed allocations answers
 *   "are people on work"; counting submitted hours answers "did people log time",
 *   and with partial timesheet coverage the second masquerades as the first.
 * - **No target column.** A target belongs next to a cumulative figure you could
 *   still act to hit, not next to a snapshot of today.
 *
 * A **table, not tiles**, for the by-role breakdown: five disciplines × three
 * figures is unreadable as tiles, and putting staffed beside headcount is the
 * whole point — the gap is the bench.
 *
 * Rows are the **delivery disciplines** only. Overhead roles aren't staffed onto
 * client work, so their rows were permanently empty noise; anyone in the billable
 * population who isn't in a delivery discipline falls into `Other`, which appears
 * only when non-empty. That keeps the rows accounting for exactly the same people as
 * the Overall row.
 *
 * ## Employment type is the axis, and there is no "All"
 *
 * Every figure here — tiles and table — describes one employment cohort, chosen by
 * the toggle. Salaried and hourly staffing aren't the same measurement: a full-time
 * person off a project is idle cost the org is already paying for, while an hourly
 * person off a project largely isn't, so a blended rate averages two things that
 * shouldn't be averaged. Hence a required two-way toggle rather than the optional
 * All/Full time/Hourly filter Availability uses next door — the combined figure is
 * the one deliberately not offered.
 *
 * **Normalized is the one exception**, and it appears on the full-time tab only. Its
 * numerator is *everyone* staffed, both cohorts; its denominator is full-time
 * headcount. So it is the whole-org figure the tab split otherwise removes, and it is
 * meaningless beside hourly headcount. Its hint says "all staffed" for exactly that
 * reason — read as full-time-over-full-time it looks like a broken duplicate of
 * Staffed rate that can somehow exceed 100%.
 */
export function StaffingPanel({
  model,
  today,
}: {
  model: StaffingModel;
  today: string;
}) {
  const [employmentType, setEmploymentType] =
    useState<EmploymentType>("FULL_TIME");

  const summary =
    employmentType === "FULL_TIME" ? model.fullTime : model.hourly;
  const cohortLabel = EMPLOYMENT_TYPE_LABELS[employmentType].toLowerCase();

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Staffing</CardTitle>
        <CardAction className="text-sm text-muted-foreground">
          As of {formatShortDate(parseIsoDate(today))}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {model.headcount === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active billable staff to report on.
          </p>
        ) : (
          <>
            {/* Rendered outside the per-cohort empty check below: an empty cohort
                must not take the toggle with it, or picking it strands you there. */}
            <SegmentedFilter
              label="Type"
              value={employmentType}
              options={EMPLOYMENT_TYPES}
              labels={EMPLOYMENT_TYPE_LABELS}
              includeAll={false}
              onChange={(value) => setEmploymentType(value as EmploymentType)}
            />

            {summary.headcount === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active {cohortLabel} staff to report on.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                  <Figure
                    label="Staffed now"
                    value={String(summary.staffed)}
                    hint="On a confirmed role today"
                  />
                  <Figure
                    label="Headcount"
                    value={String(summary.headcount)}
                    hint={`Active billable, ${cohortLabel}`}
                  />
                  <Figure
                    label="Staffed rate"
                    value={formatPercent(summary.rate)}
                    hint="Staffed ÷ headcount"
                  />
                  {employmentType === "FULL_TIME" && (
                    <Figure
                      label="Normalized"
                      value={formatPercent(model.normalizedRate)}
                      hint="All staffed ÷ full-time headcount"
                    />
                  )}
                </div>

                <div className="overflow-x-auto">
                  <Table className={ROOMY_TABLE}>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Role</TableHead>
                        <TableHead className="text-right">Staffed</TableHead>
                        <TableHead className="text-right">Headcount</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.byRole.map((row) => (
                        <StaffingRow key={row.role} row={row} />
                      ))}
                      <StaffingRow
                        row={{
                          role: "OTHER",
                          staffed: summary.staffed,
                          headcount: summary.headcount,
                          rate: summary.rate,
                        }}
                        label="Overall"
                        emphasize
                      />
                    </TableBody>
                  </Table>
                </div>

                {/* Inside the non-empty branch: it explains figures, so it has
                    nothing to say on a cohort that has none. */}
                <p className="text-xs text-muted-foreground">
                  Every figure covers <strong>{cohortLabel}</strong> staff only,
                  and counts people on a confirmed allocation today — tentative
                  work doesn&apos;t commit anyone, and approved leave
                  doesn&apos;t un-staff them.{" "}
                  {employmentType === "FULL_TIME" && (
                    <>
                      <strong>Normalized</strong> is the exception: it counts{" "}
                      <em>all</em> staffed people, hourly included, over
                      full-time headcount, so it can exceed 100%.{" "}
                    </>
                  )}
                  From the staffing plan, not timesheets.
                </p>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

/** An empty discipline shows "—": 0% of nobody is a lie, not a zero. */
function StaffingRow({
  row,
  label,
  emphasize = false,
}: {
  row: RoleStaffing;
  label?: string;
  emphasize?: boolean;
}) {
  const empty = row.headcount === 0;

  return (
    <TableRow className={cn(emphasize && "border-t-2 font-medium")}>
      <TableCell>{label ?? ROLE_ROW_LABELS[row.role]}</TableCell>
      <TableCell className="text-right tabular-nums">
        {empty ? "—" : row.staffed}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {empty ? "—" : row.headcount}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {empty ? "—" : formatPercent(row.rate)}
      </TableCell>
    </TableRow>
  );
}
