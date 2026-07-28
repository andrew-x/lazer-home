import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";

/**
 * `/performance` is a section index, not a page: the dashboards live at
 * `/performance/compensation` and `/performance/levels`. The sidebar's parent nav
 * entry points here, so send each viewer to the first dashboard they may see —
 * finance holds only `staff.viewCompensation`, so it must not land on levels.
 */
export default async function PerformancePage() {
  const user = await getCurrentUser();
  if (!user) notFound();

  if (userHasPermission(user, { staff: ["viewCompensation"] })) {
    redirect("/performance/compensation");
  }
  if (userHasPermission(user, { ratings: ["view"] })) {
    redirect("/performance/levels");
  }
  notFound();
}
