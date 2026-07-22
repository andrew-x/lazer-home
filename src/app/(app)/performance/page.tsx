import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRatingsSummaryData } from "@/actions/performance/getRatingsSummaryData";
import {
  getCompensationSummaryData,
  performanceFilterOptions,
} from "@/actions/staff/getCompensationSummaryData";
import { getExchangeRates } from "@/actions/staff/getExchangeRates";
import { PerformanceDashboard } from "@/components/performance/performance-dashboard";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "Performance" };

export default async function PerformancePage() {
  // Aggregate compensation is bulk comp exposure — gate on the same capability
  // that guards individual comp. 404 (rather than error) for unauthorized users,
  // matching the hidden nav item. The read gates again as defense in depth.
  const user = await getCurrentUser();
  if (!user || !userHasPermission(user, { staff: ["viewCompensation"] })) {
    notFound();
  }

  // Staff levels are stricter — manager/admin only (not finance). Fetch them only
  // for those who may see them; the dashboard hides the Levels section otherwise.
  const canViewLevels = userHasPermission(user, { ratings: ["view"] });

  const [records, ratingRecords, rates] = await Promise.all([
    getCompensationSummaryData(),
    canViewLevels ? getRatingsSummaryData() : Promise.resolve(undefined),
    getExchangeRates(),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Performance
        </h2>
        <p className="text-muted-foreground">
          Headcount, compensation, and levels across the team.
        </p>
      </div>

      <PerformanceDashboard
        records={records}
        ratingRecords={ratingRecords}
        rates={rates}
        filterOptions={performanceFilterOptions}
      />
    </div>
  );
}
