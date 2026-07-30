import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBonusPayments } from "@/actions/staff/getBonusPayments";
import { BonusPaymentsManager } from "@/components/performance/bonus-payments-manager";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { firstParam } from "@/lib/core/list-href";
import {
  BONUS_MANAGER_YEAR_PARAM,
  BONUS_PAYMENT_WRITE_ACCESS,
} from "@/lib/staff/staff-bonus";

export const metadata: Metadata = { title: "Bonus payments" };

type SearchParams = Record<string, string | string[] | undefined>;

/** Validate the year param, defaulting to the current calendar year. */
function parseYear(value: string | string[] | undefined): number {
  const thisYear = new Date().getFullYear();
  const parsed = Number.parseInt(firstParam(value), 10);
  if (!Number.isInteger(parsed)) return thisYear;
  return parsed >= 2000 && parsed <= thisYear + 1 ? parsed : thisYear;
}

export default async function BonusPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Recording money against a named individual needs BOTH capabilities — see
  // `BONUS_PAYMENT_WRITE_ACCESS`. 404 rather than error for anyone else, matching
  // the dashboard's convention; the read and every action gate again.
  const user = await getCurrentUser();
  if (!user || !userHasPermission(user, BONUS_PAYMENT_WRITE_ACCESS)) {
    notFound();
  }

  const year = parseYear((await searchParams)[BONUS_MANAGER_YEAR_PARAM]);
  const { payments, staffOptions, years } = await getBonusPayments(year);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Bonus payments
          </h2>
          <p className="text-muted-foreground">
            One-off bonuses that have been paid. These sit outside compensation
            — they're dated payments, not terms of employment.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<Link href="/performance/compensation" />}
        >
          Back to dashboard
        </Button>
      </div>

      <BonusPaymentsManager
        payments={payments}
        staffOptions={staffOptions}
        years={years}
        year={year}
      />
    </div>
  );
}
