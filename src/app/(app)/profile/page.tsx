import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getMyHistory } from "@/actions/staff/getMyHistory";
import { getMyProfile } from "@/actions/staff/getMyProfile";
import { getMyPto } from "@/actions/staff/getMyPto";
import { ProfileView } from "@/components/staff/profile-view";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  // `user` supplies the Google avatar image; the rest is staff data, all scoped
  // to the signed-in user. The (app) layout already guards auth.
  const [user, staffId, profile, history, pto] = await Promise.all([
    getCurrentUser(),
    getCurrentStaffId(),
    getMyProfile(),
    getMyHistory(),
    getMyPto(),
  ]);
  // The (app) layout already admits only linked, active staff, so this is
  // near-unreachable — but surface a 404 (like /staff/[id]) rather than a blank
  // page if the record vanished mid-request.
  if (!user || !staffId || !profile) notFound();

  return (
    <ProfileView
      staffId={staffId}
      imageUrl={user.image ?? null}
      profile={profile}
      history={history}
      pto={pto}
    />
  );
}
