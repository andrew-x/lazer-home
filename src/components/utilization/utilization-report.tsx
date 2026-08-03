"use client";

import { useMemo, useState } from "react";
import type { UtilizationReportData } from "@/actions/utilization/getUtilizationReport";
import { ALL } from "@/components/form/filters";
import { BenchCard } from "@/components/utilization/bench-card";
import { HeadcountCard } from "@/components/utilization/headcount-card";
import { LobAlignmentCard } from "@/components/utilization/lob-alignment-card";
import { PtoCard } from "@/components/utilization/pto-card";
import { CoverageNote } from "@/components/utilization/report-primitives";
import { RolesCard } from "@/components/utilization/roles-card";
import { StaffBreakdownCard } from "@/components/utilization/staff-breakdown-card";
import { UtilizationCard } from "@/components/utilization/utilization-card";
import { UtilizationFilters } from "@/components/utilization/utilization-filters";
import { buildUtilizationReport } from "@/lib/utilization/utilization-report";

/**
 * The **Utilization report** (`/analytics/utilization`): headcount, roles, bench,
 * PTO, utilization, a per-person breakdown, and line-of-business alignment over a
 * chosen period.
 *
 * Every hours-bearing card carries two series and never adds them together —
 * **planned** from the allocations plan (`project_roles`) and **confirmed** from
 * submitted timesheets (`time_entries`). The gap between them is the point of the
 * report; the definitions behind each number live in
 * `@/lib/utilization/utilization-report`.
 *
 * Filtering is in-memory over the once-fetched projection: narrowing the cohort by
 * line of business or flipping the forecast toggle re-derives everything client
 * side. Only the date range round-trips to the server, because it bounds the query.
 */
export function UtilizationReport({
  data,
  lineOfBusinessOptions,
}: {
  data: UtilizationReportData;
  lineOfBusinessOptions: string[];
}) {
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);
  const [includeTentative, setIncludeTentative] = useState(false);

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
        confirmedStaffIds: data.confirmedStaffIds,
        includeTentative,
      }),
    [cohort, data, includeTentative],
  );

  return (
    <div className="flex flex-col gap-6">
      <UtilizationFilters
        range={data.range}
        lineOfBusinessOptions={lineOfBusinessOptions}
        lineOfBusiness={lineOfBusiness}
        onLineOfBusinessChange={setLineOfBusiness}
        includeTentative={includeTentative}
        onIncludeTentativeChange={setIncludeTentative}
      />

      <CoverageNote coverage={report.coverage} />

      <UtilizationCard
        utilization={report.utilization}
        includeTentative={includeTentative}
      />
      <HeadcountCard headcount={report.headcount} />
      <RolesCard roles={report.roles} />
      <BenchCard bench={report.bench} />
      <PtoCard pto={report.pto} />
      <StaffBreakdownCard rows={report.staffBreakdown} />
      <LobAlignmentCard rows={report.lobAlignment} />
    </div>
  );
}
