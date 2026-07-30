import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { COMPENSATION_PLAN_ACCESS } from "@/lib/performance/compensation-plan";
import { BONUS_PAYMENT_WRITE_ACCESS } from "@/lib/staff/staff-bonus";

/**
 * `/people` is a section index, not a page: the People-management surfaces live at
 * `/people/levels`, `/people/compensation-plans` and `/people/bonus-payments`. The
 * sidebar's parent nav entry points here, so send each viewer to the first surface
 * they may use.
 *
 * All three gates happen to resolve to {manager, admin} today, so in practice this
 * always lands on the levels grid — but the ladder is written out rather than
 * short-circuited, so narrowing any one child's gate later can't silently drop a
 * viewer onto a 404.
 */
export default async function PeopleManagementPage() {
  const user = await getCurrentUser();
  if (!user) notFound();

  if (userHasPermission(user, { ratings: ["edit"] })) {
    redirect("/people/levels");
  }
  if (userHasPermission(user, COMPENSATION_PLAN_ACCESS)) {
    redirect("/people/compensation-plans");
  }
  if (userHasPermission(user, BONUS_PAYMENT_WRITE_ACCESS)) {
    redirect("/people/bonus-payments");
  }
  notFound();
}
