import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";

/**
 * `/reporting` is a section index, not a page: the reports themselves live at
 * `/reporting/utilization`, `/reporting/compensation`, `/reporting/bonuses`,
 * `/reporting/levels` and `/reporting/profile-completeness`. The sidebar's parent
 * nav entry points here, so send each viewer to the first report they may see —
 * finance holds only `staff.viewCompensation`, so it must not land on levels.
 *
 * Compensation stays the landing page for anyone who can see it, so the section
 * doesn't change under the people who use it most. Utilization is the fallback
 * rather than the default because it is the one report open to everyone — which
 * is also why profile completeness needs no branch of its own: the ladder can
 * never fall through past an ungated destination.
 */
export default async function ReportingPage() {
  const user = await getCurrentUser();
  if (!user) notFound();

  if (userHasPermission(user, { staff: ["viewCompensation"] })) {
    redirect("/reporting/compensation");
  }
  if (userHasPermission(user, { ratings: ["view"] })) {
    redirect("/reporting/levels");
  }
  redirect("/reporting/utilization");
}
