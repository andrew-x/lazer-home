import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProfileCompleteness } from "@/actions/staff/getProfileCompleteness";
import { ProfileCompletenessTable } from "@/components/staff/profile-completeness-table";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { PROFILE_COMPLETENESS_ACCESS } from "@/lib/staff/profile-completeness";

export const metadata: Metadata = { title: "Profile completeness" };

export default async function ProfileCompletenessPage() {
  // Chasing profile completion is manager/admin work (`staff.edit`). 404 rather
  // than an error, so the route can't be probed. The read carries the same gate
  // in its own right — this is the affordance, not the boundary.
  const user = await getCurrentUser();
  if (!user || !userHasPermission(user, PROFILE_COMPLETENESS_ACCESS)) {
    notFound();
  }

  const rows = await getProfileCompleteness();

  return (
    // Wider than the usual `max-w-5xl` — twelve columns need the room, and the
    // table's own container takes over with horizontal scroll below that.
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">
          Profile completeness
        </h2>
        <p className="text-muted-foreground">
          Who has filled out their staff profile. Sorting a completeness column
          ascending brings the people still to chase to the top.
        </p>
      </div>

      <ProfileCompletenessTable rows={rows} />
    </div>
  );
}
