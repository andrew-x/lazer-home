"use client";

import { EmptyState } from "@/components/empty-state";
import { InternalLink } from "@/components/internal-link";
import { ClientPaginationControls } from "@/components/pagination-controls";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportSection } from "@/components/utilization/report-primitives";
import {
  paginate,
  StaffTableFilters,
  useStaffTableFilters,
} from "@/components/utilization/staff-table-filters";
import { cn } from "@/lib/core/utils";
import {
  LINE_OF_BUSINESS,
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";
import {
  formatHours,
  formatPercent,
} from "@/lib/utilization/utilization-format";
import {
  type LobAlignmentRow,
  type LobHours,
  pickBasis,
  type ReportBasis,
  sumLobAlignment,
} from "@/lib/utilization/utilization-report";

/**
 * **Line of business alignment** — where each person's time actually sits, one row
 * per person and one column per practice.
 *
 * Both bases count **hours**, attributed by the same rule, so a row reads the same
 * way whichever series is on screen and its percentages always total 100%. The
 * rule is spelled out in the caption because it is not self-evident: notably, leave
 * taken while staffed on a project belongs to that project's practice — the client
 * is carrying the cost of the person being away — while bench time and unstaffed
 * leave sit with the person's own practice, because nobody else is carrying it.
 */
export function LobAlignmentCard({
  rows,
  basis,
  roleOptions,
  typeOptions,
}: {
  rows: LobAlignmentRow[];
  basis: ReportBasis;
  roleOptions: string[];
  typeOptions: string[];
}) {
  const filters = useStaffTableFilters();
  const matched = rows.filter((row) => filters.matches(row));
  const { visible, page, pageCount } = paginate(matched, filters.page);
  const cohort = sumLobAlignment(matched);

  const cohortHours = pickBasis(basis, cohort.planned, cohort.logged);
  const cohortTotal = pickBasis(basis, cohort.plannedTotal, cohort.loggedTotal);

  return (
    <ReportSection
      title="Line of business alignment"
      description="How much of each person's time went to each practice."
      caption="Project time belongs to the practice of the role that person held on it. Leave taken while they were staffed on a project belongs to that project's practice; leave taken while unstaffed, and unallocated bench time, belong to their own practice. Internal admin time is excluded entirely. On the logged basis, hours booked to a project someone was never staffed to also fall back to their own practice — a project carries no practice of its own, only its roles do. A person's own practice is shown in bold."
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
                  <TableHead>Type</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Line of business</TableHead>
                  {LINE_OF_BUSINESS.map((lob) => (
                    <TableHead key={lob} className="text-right">
                      {LINE_OF_BUSINESS_LABELS[lob]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => {
                  const hours = pickBasis(basis, row.planned, row.logged);
                  const total = pickBasis(
                    basis,
                    row.plannedTotal,
                    row.loggedTotal,
                  );
                  return (
                    <TableRow key={row.staffId}>
                      <TableCell className="font-medium">
                        <InternalLink href={`/staff/${row.staffId}`}>
                          {row.name}
                        </InternalLink>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.employmentType
                          ? EMPLOYMENT_TYPE_LABELS[row.employmentType]
                          : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.role ? ROLE_LABELS[row.role] : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.lineOfBusiness
                          ? LINE_OF_BUSINESS_LABELS[row.lineOfBusiness]
                          : "—"}
                      </TableCell>
                      <ShareCells
                        hours={hours}
                        total={total}
                        home={row.lineOfBusiness}
                      />
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium">All</TableCell>
                  <TableCell colSpan={3} className="text-muted-foreground">
                    {formatHours(cohortTotal)} attributed
                  </TableCell>
                  <ShareCells
                    hours={cohortHours}
                    total={cohortTotal}
                    home={null}
                  />
                </TableRow>
              </TableFooter>
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

/**
 * One percentage per practice. A practice with no hours renders "—" rather than
 * "0.0%" so the columns that carry something stay scannable across a long table.
 */
function ShareCells({
  hours,
  total,
  home,
}: {
  hours: LobHours | null;
  total: number | null;
  /** The person's own practice, emphasized so the off-practice work stands out. */
  home: LineOfBusiness | null;
}) {
  return (
    <>
      {LINE_OF_BUSINESS.map((lob) => {
        const value = hours?.[lob] ?? 0;
        return (
          <TableCell
            key={lob}
            className={cn(
              "text-right tabular-nums",
              lob === home && "font-medium",
            )}
          >
            {hours == null || total == null || total === 0 || value === 0
              ? "—"
              : formatPercent(value / total)}
          </TableCell>
        );
      })}
    </>
  );
}
