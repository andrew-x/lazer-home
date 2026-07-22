import { IconArrowLeft } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getWaysOfWorking } from "@/actions/responses/getWaysOfWorking";
import { canEditStaff } from "@/actions/staff/canEditStaff";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getStaffProfile } from "@/actions/staff/getStaffProfile";
import { WaysOfWorkingGuide } from "@/components/staff/ways-of-working-guide";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/auth";

export const metadata: Metadata = { title: "Ways of Working" };

export default async function WaysOfWorkingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [profile, user, currentStaffId, responses] = await Promise.all([
    getStaffProfile(id),
    getCurrentUser(),
    getCurrentStaffId(),
    getWaysOfWorking(id),
  ]);

  if (!profile) notFound();

  // Editing is the server boundary (upsertResponse's authorizeStaffEdit); the
  // profile only links here when the viewer may edit. Anyone reaching this URL
  // without rights gets a 404, matching the Manual of Me editor.
  const canEdit = user ? await canEditStaff(user, id) : false;
  if (!canEdit) notFound();

  const isSelf = currentStaffId === id;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
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
            {isSelf ? "Ways of Working" : `${profile.name}'s Ways of Working`}
          </span>
          <p className="text-sm text-muted-foreground">
            How you like to work and use AI — so teammates can learn from and
            work well with you. Fill sections in any order; everything saves as
            you go.
          </p>
        </div>
      </div>

      <WaysOfWorkingGuide staffId={id} responses={responses} />
    </div>
  );
}
