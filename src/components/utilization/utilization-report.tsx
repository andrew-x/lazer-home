"use client";

import { useMemo, useState } from "react";
import type { UtilizationReportData } from "@/actions/utilization/getUtilizationReport";
import { ALL } from "@/components/form/filters";
import { BenchCard } from "@/components/utilization/bench-card";
import { HeadcountCard } from "@/components/utilization/headcount-card";
import { LobAlignmentCard } from "@/components/utilization/lob-alignment-card";
import { PtoCard } from "@/components/utilization/pto-card";
import { BasisNote } from "@/components/utilization/report-primitives";
import { RolesCard } from "@/components/utilization/roles-card";
import { StaffBreakdownCard } from "@/components/utilization/staff-breakdown-card";
import { UtilizationCard } from "@/components/utilization/utilization-card";
import { UtilizationFilters } from "@/components/utilization/utilization-filters";
import {
  buildUtilizationReport,
  type ReportBasis,
} from "@/lib/utilization/utilization-report";

/**
 * The **Utilization report** (`/analytics/utilization`): the utilization split
 * first as the headline, then headcount, roles, bench and PTO behind it, then the
 * per-person breakdown and line-of-business alignment, over a chosen period.
 *
 * Every hours-bearing figure exists in two series — **planned** from the
 * allocations plan (`project_roles`) and **logged** from submitted timesheets
 * (`time_entries`) — and the basis toggle picks which one the whole page shows.
 * The other series doesn't go to waste: on the logged basis a figure far enough
 * from plan is flagged, which is the comparison that mattered without paying for
 * it in a doubled column on every row. Definitions live in
 * `@/lib/utilization/utilization-report`.
 *
 * Filtering is in-memory over the once-fetched projection: narrowing the cohort
 * by line of business or flipping the basis re-derives everything client side.
 * Only the date range round-trips to the server, because it bounds the query.
 */
export function UtilizationReport({
  data,
  today,
  lineOfBusinessOptions,
  roleOptions,
  typeOptions,
}: {
  data: UtilizationReportData;
  today: string;
  lineOfBusinessOptions: string[];
  roleOptions: string[];
  typeOptions: string[];
}) {
  const [basis, setBasis] = useState<ReportBasis>("planned");
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);

  const cohort = useMemo(
    () =>
      lineOfBusiness === ALL
        ? data.staff
        : data.staff.filter((p) => p.lineOfBusiness === lineOfBusiness),
    [data.staff, lineOfBusiness],
  );

  const report = useMemo(
    () =>
      buildUtilizationReport({
        staff: cohort,
        roles: data.roles,
        pto: data.pto,
        entries: data.entries,
        weeks: data.weeks,
        firstRoleStartByStaff: data.firstRoleStartByStaff,
        range: data.range,
        canViewLogged: data.canViewLogged,
      }),
    [cohort, data],
  );

  return (
    <div className="flex flex-col gap-6">
      <UtilizationFilters
        range={data.range}
        today={today}
        basis={basis}
        onBasisChange={setBasis}
        canViewLogged={data.canViewLogged}
        lineOfBusinessOptions={lineOfBusinessOptions}
        lineOfBusiness={lineOfBusiness}
        onLineOfBusinessChange={setLineOfBusiness}
      />

      <BasisNote basis={basis} coverage={report.coverage} />

      <UtilizationCard utilization={report.utilization} basis={basis} />
      <HeadcountCard headcount={report.headcount} />
      <RolesCard roles={report.roles} basis={basis} />
      <BenchCard bench={report.bench} basis={basis} />
      <PtoCard pto={report.pto} basis={basis} />
      <StaffBreakdownCard
        rows={report.staffBreakdown}
        basis={basis}
        roleOptions={roleOptions}
        typeOptions={typeOptions}
      />
      <LobAlignmentCard
        rows={report.lobAlignment}
        basis={basis}
        roleOptions={roleOptions}
        typeOptions={typeOptions}
      />
    </div>
  );
}
