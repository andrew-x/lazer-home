import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  financeFilterOptions,
  getFinanceReport,
} from "@/actions/finance/getFinanceReport";
import { LINE_OF_BUSINESS_PARAM } from "@/components/finance/finance-filters";
import { FinanceReport } from "@/components/finance/finance-report";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import {
  LINE_OF_BUSINESS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import {
  FINANCE_REPORT_ACCESS,
  MAX_FINANCE_RANGE_DAYS,
} from "@/lib/finance/finance-report";
import { formatDateRange } from "@/lib/format/format";
import {
  parseReportRange,
  RANGE_END_PARAM,
  RANGE_START_PARAM,
} from "@/lib/reporting/report-range";
import { currentDay } from "@/lib/timesheets/timesheet-week";

export const metadata: Metadata = { title: "Finance" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The **Finance report** (`/reporting/finance`).
 *
 * Gated on `projects.viewMargin` — the capability these readers already hold to
 * see a single project's cost and margin; this aggregates the same
 * compensation-derived disclosure across the portfolio, so no new capability and no
 * change to the permission matrix. `notFound()` rather than an error, so the route
 * can't be probed by a viewer who shouldn't know it exists, and `getFinanceReport`
 * re-checks the same constant as defence in depth.
 *
 * Both filters are read off the URL because both bound the server query: the window
 * decides which projects are read at all, and the line of business decides which
 * roles are counted — which in turn changes how a fixed fee prorates.
 *
 * `today` is resolved here rather than in the browser so the range presets agree
 * with the window this page defaulted to, whatever the viewer's timezone.
 */
export default async function FinanceReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getCurrentUser();
  if (!user || !userHasPermission(user, FINANCE_REPORT_ACCESS)) notFound();

  const params = await searchParams;
  const today = currentDay();
  const range = parseReportRange(
    params[RANGE_START_PARAM],
    params[RANGE_END_PARAM],
    today,
    MAX_FINANCE_RANGE_DAYS,
  );
  const lineOfBusiness = parseLineOfBusiness(params[LINE_OF_BUSINESS_PARAM]);

  const data = await getFinanceReport({ range, lineOfBusiness });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Finance
        </h2>
        <p className="text-muted-foreground">
          Plan revenue, margin and rates over{" "}
          {formatDateRange(range.start, range.end)} — from confirmed and
          tentative project roles, in CAD or USD. Committed billings, not
          invoices.
        </p>
      </div>

      <FinanceReport
        data={data}
        today={today}
        lineOfBusinessOptions={financeFilterOptions.lineOfBusiness}
      />
    </div>
  );
}

/**
 * The line-of-business param, validated against the canonical tuple. An unknown or
 * repeated value degrades to "no filter" rather than erroring — a mistyped URL
 * should still render a report, the same forgiveness `parseReportRange` applies.
 */
function parseLineOfBusiness(
  value: string | string[] | undefined,
): LineOfBusiness | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return LINE_OF_BUSINESS.find((lob) => lob === raw) ?? null;
}
