import { IconArrowLeft } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStaffRatingsForEdit } from "@/actions/performance/getStaffRatingsForEdit";
import { EditLevels } from "@/components/performance/edit-levels";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "Edit levels" };

export default async function EditLevelsPage() {
  // Assigning levels requires ratings.edit (manager/admin). 404 otherwise.
  const user = await getCurrentUser();
  if (!user || !userHasPermission(user, { ratings: ["edit"] })) {
    notFound();
  }

  const rows = await getStaffRatingsForEdit();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/performance"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <IconArrowLeft className="size-4" />
          Back to performance
        </Link>
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Edit levels
          </h2>
          <p className="text-muted-foreground">
            Set each active staff member's overall level. Saving records a dated
            evaluation, preserving the level history.
          </p>
        </div>
      </div>

      <EditLevels rows={rows} />
    </div>
  );
}
