import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getManualOfMe } from "@/actions/responses/getManualOfMe";
import { canEditStaff } from "@/actions/staff/canEditStaff";
import { canViewCompensation } from "@/actions/staff/canViewCompensation";
import { getStaffAvatar } from "@/actions/staff/getStaffAvatar";
import { getStaffHistory } from "@/actions/staff/getStaffHistory";
import { getStaffProfile } from "@/actions/staff/getStaffProfile";
import { getStaffPto } from "@/actions/staff/getStaffPto";
import { ProfileView } from "@/components/staff/profile-view";
import { getCurrentUser } from "@/lib/auth";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const profile = await getStaffProfile(id);
  return { title: profile?.name ?? "Staff profile" };
}

export default async function StaffProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [profile, pto, imageUrl, user, manualOfMe] = await Promise.all([
    getStaffProfile(id),
    getStaffPto(id),
    getStaffAvatar(id),
    getCurrentUser(),
    getManualOfMe(id),
  ]);

  if (!profile) notFound();

  // UI affordances only — the actions/reads still enforce server-side.
  const [canEdit, canViewComp] = user
    ? await Promise.all([canEditStaff(user, id), canViewCompensation(user, id)])
    : [false, false];

  // Comp entries are gated at the read (HistorySheet is a client component).
  const history = await getStaffHistory(id, canViewComp);

  return (
    <ProfileView
      staffId={id}
      imageUrl={imageUrl}
      profile={profile}
      manualOfMe={manualOfMe}
      history={history}
      pto={pto}
      canEdit={canEdit}
      canViewCompensation={canViewComp}
    />
  );
}
