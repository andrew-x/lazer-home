import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBonusSummaryData } from "@/actions/performance/getBonusSummaryData";
import { performanceFilterOptions } from "@/actions/staff/getCompensationSummaryData";
import { getExchangeRates } from "@/actions/staff/getExchangeRates";
import { BonusDashboard } from "@/components/performance/bonus-dashboard";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import {
  BONUS_PAYMENT_READ_ACCESS,
  BONUS_PAYMENT_WRITE_ACCESS,
  BONUS_YEAR_PARAM,
  parseBonusYear,
} from "@/lib/staff/staff-bonus";

export const metadata: Metadata = { title: "Bonuses" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function BonusDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Reading bonus totals is reading compensation — the same gate as the sibling
  // Compensation dashboard. 404 (rather than error) for unauthorized users,
  // matching the hidden nav item; the read gates again as defense in depth.
  const user = await getCurrentUser();
  if (!user || !userHasPermission(user, BONUS_PAYMENT_READ_ACCESS)) {
    notFound();
  }

  // Whether to offer the link to the entry screen. The screen and its actions
  // gate themselves; this only decides whether a viewer sees a link they could
  // actually use (finance may read these totals but not record payments).
  const canEditBonuses = userHasPermission(user, BONUS_PAYMENT_WRITE_ACCESS);

  const year = parseBonusYear((await searchParams)[BONUS_YEAR_PARAM]);

  const [bonuses, rates] = await Promise.all([
    getBonusSummaryData(year),
    getExchangeRates(),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Bonus dashboard
        </h2>
        <p className="text-muted-foreground">
          One-off bonuses paid out in a calendar year, by line of business, role
          and type.
        </p>
      </div>

      <BonusDashboard
        bonuses={bonuses}
        year={year}
        rates={rates}
        filterOptions={performanceFilterOptions}
        canEditBonuses={canEditBonuses}
      />
    </div>
  );
}
