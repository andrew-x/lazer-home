import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";

/**
 * `/analytics` is a section index, not a page: the dashboards themselves live at
 * `/analytics/utilization`, `/analytics/compensation`, `/analytics/bonuses` and
 * `/analytics/levels`. The sidebar's parent nav entry points here, so send each
 * viewer to the first dashboard they may see — finance holds only
 * `staff.viewCompensation`, so it must not land on levels.
 *
 * Compensation stays the landing page for anyone who can see it, so the section
 * doesn't change under the people who use it most. Utilization is the fallback
 * rather than the default because it is the one dashboard open to everyone.
 */
export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) notFound();

  if (userHasPermission(user, { staff: ["viewCompensation"] })) {
    redirect("/analytics/compensation");
  }
  if (userHasPermission(user, { ratings: ["view"] })) {
    redirect("/analytics/levels");
  }
  redirect("/analytics/utilization");
}
