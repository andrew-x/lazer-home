import { IconArrowLeft } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getManualOfMe } from "@/actions/responses/getManualOfMe";
import { canEditStaff } from "@/actions/staff/canEditStaff";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getStaffProfile } from "@/actions/staff/getStaffProfile";
import { ManualOfMeGuide } from "@/components/staff/manual-of-me-guide";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Manual of Me" };

export default async function ManualOfMePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [profile, user, currentStaffId, entries] = await Promise.all([
    getStaffProfile(id),
    getCurrentUser(),
    getCurrentStaffId(),
    getManualOfMe(id),
  ]);

  if (!profile) notFound();

  // Editing is the server boundary (upsertResponse's authorizeStaffEdit); the
  // profile only links here when the viewer may edit. Anyone reaching this URL
  // without rights gets a 404, matching the skills editor.
  const canEdit = user ? await canEditStaff(user, id) : false;
  if (!canEdit) notFound();

  const isSelf = currentStaffId === id;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit"
          nativeButton={false}
          render={<Link href={`/staff/${id}`} />}
        >
          <IconArrowLeft />
          Back to profile
        </Button>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {isSelf ? "Manual of Me" : `${profile.name}'s Manual of Me`}
          </span>
          <p className="text-sm text-muted-foreground">
            A few notes on how you work best — so the team can work well with
            you. Answer in any order; everything saves as you go.
          </p>
        </div>
      </div>

      <ManualOfMeGuide staffId={id} entries={entries} />
    </div>
  );
}
