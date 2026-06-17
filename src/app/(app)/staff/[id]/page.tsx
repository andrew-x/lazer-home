import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStaffAvatar } from "@/actions/staff/getStaffAvatar";
import { getStaffHistory } from "@/actions/staff/getStaffHistory";
import { getStaffProfile } from "@/actions/staff/getStaffProfile";
import { getStaffPto } from "@/actions/staff/getStaffPto";
import { ProfileView } from "@/components/staff/profile-view";

export const metadata: Metadata = { title: "Staff profile" };

export default async function StaffProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [profile, history, pto, imageUrl] = await Promise.all([
    getStaffProfile(id),
    getStaffHistory(id),
    getStaffPto(id),
    getStaffAvatar(id),
  ]);

  if (!profile) notFound();

  return (
    <ProfileView
      staffId={id}
      imageUrl={imageUrl}
      profile={profile}
      history={history}
      pto={pto}
    />
  );
}
