import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBonusSummaryData } from "@/actions/performance/getBonusSummaryData";
import { getRatingsSummaryData } from "@/actions/performance/getRatingsSummaryData";
import {
  getCompensationSummaryData,
  performanceFilterOptions,
} from "@/actions/staff/getCompensationSummaryData";
import { getExchangeRates } from "@/actions/staff/getExchangeRates";
import { CompensationDashboard } from "@/components/performance/compensation-dashboard";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { firstParam } from "@/lib/core/list-href";
import {
  BONUS_PAYMENT_WRITE_ACCESS,
  BONUS_YEAR_PARAM,
} from "@/lib/staff/staff-bonus";

export const metadata: Metadata = { title: "Compensation" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Validate the `bonusYear` param, falling back to the current calendar year.
 * Bounded to a plausible range so a crafted value can't drive an absurd query or
 * render a nonsense heading.
 */
function parseBonusYear(value: string | string[] | undefined): number {
  const thisYear = new Date().getFullYear();
  const parsed = Number.parseInt(firstParam(value), 10);
  if (!Number.isInteger(parsed)) return thisYear;
  return parsed >= 2000 && parsed <= thisYear + 1 ? parsed : thisYear;
}

export default async function CompensationDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Aggregate compensation is bulk comp exposure — gate on the same capability
  // that guards individual comp. 404 (rather than error) for unauthorized users,
  // matching the hidden nav item. The read gates again as defense in depth.
  const user = await getCurrentUser();
  if (!user || !userHasPermission(user, { staff: ["viewCompensation"] })) {
    notFound();
  }

  // The by-level breakdown needs levels, which are stricter than comp
  // (manager/admin, not finance) — fetch them only for those who may see them;
  // the dashboard hides that one table otherwise.
  const canViewLevels = userHasPermission(user, { ratings: ["view"] });
  // Whether to offer the link to the entry screen. The screen and its actions
  // gate themselves; this only decides whether a viewer sees a link they could
  // actually use (finance may read these totals but not record payments).
  const canEditBonuses = userHasPermission(user, BONUS_PAYMENT_WRITE_ACCESS);

  const bonusYear = parseBonusYear((await searchParams)[BONUS_YEAR_PARAM]);

  const [records, ratingRecords, rates, bonuses] = await Promise.all([
    getCompensationSummaryData(),
    canViewLevels ? getRatingsSummaryData() : Promise.resolve(undefined),
    getExchangeRates(),
    getBonusSummaryData(bonusYear),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Compensation dashboard
        </h2>
        <p className="text-muted-foreground">
          Headcount and compensation across the team, by role and by level, plus
          bonuses paid out.
        </p>
      </div>

      <CompensationDashboard
        records={records}
        ratingRecords={ratingRecords}
        rates={rates}
        filterOptions={performanceFilterOptions}
        bonuses={bonuses}
        bonusYear={bonusYear}
        canEditBonuses={canEditBonuses}
      />
    </div>
  );
}
