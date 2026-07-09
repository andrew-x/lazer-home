import { IconArrowLeft } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canEditStaff } from "@/actions/staff/canEditStaff";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getStaffProfile } from "@/actions/staff/getStaffProfile";
import { EditSkillsForm } from "@/components/staff/edit-skills-form";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Edit skills" };

export default async function EditSkillsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [profile, user, currentStaffId] = await Promise.all([
    getStaffProfile(id),
    getCurrentUser(),
    getCurrentStaffId(),
  ]);

  if (!profile) notFound();

  // Editing is gated server-side; the profile only surfaces the edit link when
  // the viewer may edit. Anyone reaching this URL without rights gets a 404.
  const canEdit = user ? await canEditStaff(user, id) : false;
  if (!canEdit) notFound();

  const isSelf = currentStaffId === id;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit"
          render={<Link href={`/staff/${id}`} />}
        >
          <IconArrowLeft />
          Back to profile
        </Button>
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            {isSelf ? "Edit skills" : `Edit ${profile.name}'s skills`}
          </h2>
          <p className="text-muted-foreground">
            Pick a level, then add skills from the catalogue.
          </p>
        </div>
      </div>

      <EditSkillsForm staffId={id} initialSkills={profile.skills} />
    </div>
  );
}
