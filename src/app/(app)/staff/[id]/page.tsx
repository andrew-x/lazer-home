import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canEditStaff } from "@/actions/staff/canEditStaff";
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

  const [profile, history, pto, imageUrl, user] = await Promise.all([
    getStaffProfile(id),
    getStaffHistory(id),
    getStaffPto(id),
    getStaffAvatar(id),
    getCurrentUser(),
  ]);

  if (!profile) notFound();

  // UI affordance only — the edit actions still enforce server-side.
  const canEdit = user ? await canEditStaff(user, id) : false;

  return (
    <ProfileView
      staffId={id}
      imageUrl={imageUrl}
      profile={profile}
      history={history}
      pto={pto}
      canEdit={canEdit}
    />
  );
}
