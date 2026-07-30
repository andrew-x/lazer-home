import { IconArrowLeft } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompensationPlan } from "@/actions/performance/getCompensationPlan";
import { getStaffForCompensationPlan } from "@/actions/performance/getStaffForCompensationPlan";
import { ManagePlanStaff } from "@/components/performance/compensation-plans/manage-plan-staff";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { COMPENSATION_PLAN_ACCESS } from "@/lib/performance/compensation-plan";

export const metadata: Metadata = { title: "Plan staff" };

type Params = { params: Promise<{ planId: string }> };

export default async function CompensationPlanStaffPage({ params }: Params) {
  const { planId } = await params;

  const user = await getCurrentUser();
  if (!user || !userHasPermission(user, COMPENSATION_PLAN_ACCESS)) {
    notFound();
  }

  const [plan, candidates] = await Promise.all([
    getCompensationPlan(planId),
    getStaffForCompensationPlan(),
  ]);

  if (!plan) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/people/compensation-plans/${planId}`}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <IconArrowLeft className="size-4" />
          Back to {plan.name}
        </Link>
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Plan staff
          </h2>
          <p className="text-muted-foreground">
            Choose who this round covers. Adding someone seeds their row from
            their current rating; removing someone discards their row.
          </p>
        </div>
      </div>

      <ManagePlanStaff
        planId={plan.id}
        planName={plan.name}
        items={plan.items}
        candidates={candidates}
        readOnly={plan.status === "COMMITTED"}
      />
    </div>
  );
}
