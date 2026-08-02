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
  parseUtilizationRange,
  RANGE_END_PARAM,
  RANGE_START_PARAM,
} from "@/lib/utilization/utilization-range";

export const metadata: Metadata = { title: "Utilization" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The **Utilization report** (`/dashboards/utilization`).
 *
 * No capability gate beyond being signed in: the planned series re-aggregates
 * what the allocations planner already discloses to everyone (role spans, hours
 * per day, line of business, approved leave dates). The one sensitive series —
 * confirmed hours from other people's timesheets — is withheld inside
 * `getUtilizationReport` for viewers without `timesheets.edit`, so it is never
 * serialised to a client that may not see it.
 */
export default async function UtilizationReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getCurrentUser();
  if (!user) notFound();

  const params = await searchParams;
  const range = parseUtilizationRange(
    params[RANGE_START_PARAM],
    params[RANGE_END_PARAM],
  );

  const data = await getUtilizationReport(range);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Utilization
        </h2>
        <p className="text-muted-foreground">
          Capacity, staffing and logged time for billable staff over{" "}
          {formatDateRange(range.start, range.end)} — the allocations plan and
          submitted timesheets side by side.
        </p>
      </div>

      <UtilizationReport
        data={data}
        lineOfBusinessOptions={utilizationFilterOptions.lineOfBusiness}
      />
    </div>
  );
}
