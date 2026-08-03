"use client";

import { EmptyState } from "@/components/empty-state";
import { InternalLink } from "@/components/internal-link";
import { ClientPaginationControls } from "@/components/pagination-controls";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DeviationFlag,
  ReportSection,
} from "@/components/utilization/report-primitives";
import {
  paginate,
  StaffTableFilters,
  useStaffTableFilters,
} from "@/components/utilization/staff-table-filters";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";
import {
  formatHours,
  formatPercent,
} from "@/lib/utilization/utilization-format";
import {
  type HoursMetric,
  hoursFor,
  type ReportBasis,
  type StaffBreakdownRow,
  shareFor,
} from "@/lib/utilization/utilization-report";

/**
 * **Staff utilization breakdown** — one row per person: their capacity for the
 * period, and how the time against it splits into project, PTO and bench, all on
 * the basis the report is currently showing. The per-person view of the
 * Utilization section's cohort figures.
 *
 * Hourly staff show no capacity, and no PTO or bench: both are measured against a
 * fixed working week they don't have. Their project hours still count.
 */
export function StaffBreakdownCard({
  rows,
  basis,
  roleOptions,
  typeOptions,
}: {
  rows: StaffBreakdownRow[];
  basis: ReportBasis;
  roleOptions: string[];
  typeOptions: string[];
}) {
  const filters = useStaffTableFilters();
  // Not memoized: the cohort is one already-fetched projection of tens of rows,
  // and the whole report re-derives on a filter change anyway.
  const matched = rows.filter((row) => filters.matches(row));
  const { visible, page, pageCount } = paginate(matched, filters.page);

  return (
    <ReportSection
      title="Staff utilization breakdown"
      description="Capacity and how each person's time was used."
      caption="Available hours are adjusted for join and termination dates, so someone who started mid-period has a smaller denominator. Percentages are shares of that person's available hours, which is why an over-allocated person can exceed 100%."
    >
      <StaffTableFilters
        filters={filters}
        roleOptions={roleOptions}
        typeOptions={typeOptions}
        shown={matched.length}
        total={rows.length}
      />

      {matched.length === 0 ? (
        <EmptyState bordered>No staff match these filters.</EmptyState>
      ) : (
        <div className="rounded border">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Line of business</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Project</TableHead>
                  <TableHead className="text-right">Project %</TableHead>
                  <TableHead className="text-right">PTO</TableHead>
                  <TableHead className="text-right">PTO %</TableHead>
                  <TableHead className="text-right">Bench</TableHead>
                  <TableHead className="text-right">Bench %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.staffId}>
                    <TableCell className="font-medium">
                      <InternalLink href={`/staff/${row.staffId}`}>
                        {row.name}
                      </InternalLink>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.lineOfBusiness
                        ? LINE_OF_BUSINESS_LABELS[row.lineOfBusiness]
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.employmentType
                        ? EMPLOYMENT_TYPE_LABELS[row.employmentType]
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.role ? ROLE_LABELS[row.role] : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.availableHours == null ? (
                        <NoCapacity employmentType={row.employmentType} />
                      ) : (
                        formatHours(row.availableHours)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatHours(hoursFor(row.project.hours, basis))}
                      <DeviationFlag series={row.project.hours} basis={basis} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPercent(shareFor(row.project, basis))}
                    </TableCell>
                    <MetricCells
                      metric={row.pto}
                      basis={basis}
                      employmentType={row.employmentType}
                    />
                    <MetricCells
                      metric={row.bench}
                      basis={basis}
                      employmentType={row.employmentType}
                    />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ClientPaginationControls
            page={page}
            pageCount={pageCount}
            onPageChange={filters.setPage}
          />
        </div>
      )}
    </ReportSection>
  );
}

/** The hours + share pair for a metric that only full-time staff have. */
function MetricCells({
  metric,
  basis,
  employmentType,
}: {
  metric: HoursMetric | null;
  basis: ReportBasis;
  employmentType: StaffBreakdownRow["employmentType"];
}) {
  if (metric == null) {
    return (
      <>
        <TableCell className="text-right tabular-nums">
          <NoCapacity employmentType={employmentType} />
        </TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">
          —
        </TableCell>
      </>
    );
  }
  return (
    <>
      <TableCell className="text-right tabular-nums">
        {formatHours(hoursFor(metric.hours, basis))}
        <DeviationFlag series={metric.hours} basis={basis} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatPercent(shareFor(metric, basis))}
      </TableCell>
    </>
  );
}

/** Why a cell is blank for someone without a fixed working week. */
function NoCapacity({
  employmentType,
}: {
  employmentType: StaffBreakdownRow["employmentType"];
}) {
  return (
    <span
      className="text-muted-foreground"
      title={`${employmentType ? EMPLOYMENT_TYPE_LABELS[employmentType] : "Non full-time"} — no fixed capacity to measure against`}
    >
      n/a
    </span>
  );
}
