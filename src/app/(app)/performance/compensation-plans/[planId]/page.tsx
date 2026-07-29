import { IconArrowLeft } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompensationPlan } from "@/actions/performance/getCompensationPlan";
import { getExchangeRates } from "@/actions/staff/getExchangeRates";
import { PlanEditor } from "@/components/performance/compensation-plans/plan-editor";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/format/format";
import { COMPENSATION_PLAN_ACCESS } from "@/lib/performance/compensation-plan";

type Params = { params: Promise<{ planId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { planId } = await params;
  const user = await getCurrentUser();
  // Don't leak a plan's name through the tab title to someone who can't open it.
  if (!user || !userHasPermission(user, COMPENSATION_PLAN_ACCESS)) {
    return { title: "Compensation plans" };
  }
  const plan = await getCompensationPlan(planId);
  return { title: plan?.name ?? "Compensation plan" };
}

export default async function CompensationPlanPage({ params }: Params) {
  const { planId } = await params;

  const user = await getCurrentUser();
  if (!user || !userHasPermission(user, COMPENSATION_PLAN_ACCESS)) {
    notFound();
  }

  const [plan, rates] = await Promise.all([
    getCompensationPlan(planId),
    getExchangeRates(),
  ]);

  if (!plan) notFound();

  return (
    // Full width and pinned to the viewport, unlike the app's other pages: this
    // grid is 11 columns of dense numbers that a comp round is read across, so
    // horizontal room matters more than a comfortable measure. Fixing the height
    // (the shell's own `p-4`/`md:p-6` is the only other vertical chrome) lets the
    // table pane own the scrolling, keeping the filters and column headers in place
    // instead of walking off the top of a long page.
    <div className="flex h-[calc(100svh-2rem)] w-full min-w-0 flex-col gap-4 md:h-[calc(100svh-3rem)]">
      <div className="flex flex-col gap-1">
        <Link
          href="/performance/compensation-plans"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <IconArrowLeft className="size-4" />
          Back to compensation plans
        </Link>
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            {plan.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            Ratings take effect {formatDate(plan.effectiveDate)}. Planned
            compensation is a proposal — pay is still changed in Rippling.
          </p>
        </div>
      </div>

      <PlanEditor plan={plan} rates={rates} />
    </div>
  );
}
