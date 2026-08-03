import { IconArrowLeft } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompensationPlans } from "@/actions/performance/getCompensationPlans";
import { PlansList } from "@/components/performance/compensation-plans/plans-list";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { COMPENSATION_PLAN_ACCESS } from "@/lib/performance/compensation-plan";

export const metadata: Metadata = { title: "Compensation plans" };

export default async function CompensationPlansPage() {
  // Named, per-person compensation proposals that also write ratings — needs
  // both capabilities. 404 (not error) for everyone else, matching the hidden
  // nav item; the read gates again as defense in depth.
  const user = await getCurrentUser();
  if (!user || !userHasPermission(user, COMPENSATION_PLAN_ACCESS)) {
    notFound();
  }

  const plans = await getCompensationPlans();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        {/* Straight to the Compensation dashboard, not the `/analytics`
            redirect (ADR 0044): COMPENSATION_PLAN_ACCESS already implies
            `staff.viewCompensation`, so this link can never 404. */}
        <Link
          href="/analytics/compensation"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <IconArrowLeft className="size-4" />
          Back to compensation
        </Link>
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Compensation plans
          </h2>
          <p className="text-muted-foreground">
            Plan a round of compensation changes across a group of staff.
            Committing a plan records the ratings; the compensation itself is
            still applied in Rippling.
          </p>
        </div>
      </div>

      <PlansList plans={plans} />
    </div>
  );
}
