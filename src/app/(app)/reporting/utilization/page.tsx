import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getUtilizationReport,
  utilizationFilterOptions,
} from "@/actions/utilization/getUtilizationReport";
import { UtilizationReport } from "@/components/utilization/utilization-report";
import { getCurrentUser } from "@/lib/auth/auth";
import { formatDateRange } from "@/lib/format/format";
import {
  parseReportRange,
  RANGE_END_PARAM,
  RANGE_START_PARAM,
} from "@/lib/reporting/report-range";
import { currentDay } from "@/lib/timesheets/timesheet-week";

export const metadata: Metadata = { title: "Utilization" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The **Utilization report** (`/reporting/utilization`).
 *
 * No capability gate beyond being signed in: the planned series re-aggregates
 * what the allocations planner already discloses to everyone (role spans, hours
 * per day, line of business, approved leave dates). The one sensitive series —
 * logged hours from other people's timesheets — is withheld inside
 * `getUtilizationReport` for viewers without `timesheets.edit`, so it is never
 * serialised to a client that may not see it.
 *
 * `today` is resolved here rather than in the browser so the range presets agree
 * with the window this page defaulted to, whatever the viewer's timezone.
 */
export default async function UtilizationReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getCurrentUser();
  if (!user) notFound();

  const params = await searchParams;
  const today = currentDay();
  const range = parseReportRange(
    params[RANGE_START_PARAM],
    params[RANGE_END_PARAM],
    today,
  );

  const data = await getUtilizationReport(range);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Utilization
        </h2>
        <p className="text-muted-foreground">
          Capacity, staffing and time use for billable staff over{" "}
          {formatDateRange(range.start, range.end)} — from the allocations plan,
          or from submitted timesheets.
        </p>
      </div>

      <UtilizationReport
        data={data}
        today={today}
        lineOfBusinessOptions={utilizationFilterOptions.lineOfBusiness}
        roleOptions={utilizationFilterOptions.role}
        typeOptions={utilizationFilterOptions.employmentType}
      />
    </div>
  );
}
