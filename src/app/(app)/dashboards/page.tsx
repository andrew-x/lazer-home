import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";

/**
 * `/dashboards` is a section index, not a page: the dashboards themselves live at
 * `/dashboards/compensation`, `/dashboards/bonuses` and `/dashboards/levels`. The
 * sidebar's parent nav entry points here, so send each viewer to the first
 * dashboard they may see — finance holds only `staff.viewCompensation`, so it must
 * not land on levels.
 */
export default async function DashboardsPage() {
  const user = await getCurrentUser();
  if (!user) notFound();

  if (userHasPermission(user, { staff: ["viewCompensation"] })) {
    redirect("/dashboards/compensation");
  }
  if (userHasPermission(user, { ratings: ["view"] })) {
    redirect("/dashboards/levels");
  }
  notFound();
}
