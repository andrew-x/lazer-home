import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getCompensationSummaryData,
  performanceFilterOptions,
} from "@/actions/staff/getCompensationSummaryData";
import { getExchangeRates } from "@/actions/staff/getExchangeRates";
import { PerformanceDashboard } from "@/components/performance/performance-dashboard";
import { getCurrentUser } from "@/lib/auth";
import { userHasPermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Performance" };

export default async function PerformancePage() {
  // Aggregate compensation is bulk comp exposure — gate on the same capability
  // that guards individual comp. 404 (rather than error) for unauthorized users,
  // matching the hidden nav item. The read gates again as defense in depth.
  const user = await getCurrentUser();
  if (!user || !userHasPermission(user, { staff: ["viewCompensation"] })) {
    notFound();
  }

  const [records, rates] = await Promise.all([
    getCompensationSummaryData(),
    getExchangeRates(),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Performance
        </h2>
        <p className="text-muted-foreground">
          Headcount and compensation across the team, by role.
        </p>
      </div>

      <PerformanceDashboard
        records={records}
        rates={rates}
        filterOptions={performanceFilterOptions}
      />
    </div>
  );
}
