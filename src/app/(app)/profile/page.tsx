import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getStaffHistory } from "@/actions/staff/getStaffHistory";
import { getStaffProfile } from "@/actions/staff/getStaffProfile";
import { getStaffPto } from "@/actions/staff/getStaffPto";
import { ProfileView } from "@/components/staff/profile-view";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  // `user` supplies the Google avatar image. The profile data is the signed-in
  // user's own, read through the same parameterized actions /staff/[id] uses —
  // there's no separate "my" read. The (app) layout already guards auth.
  const [user, staffId] = await Promise.all([
    getCurrentUser(),
    getCurrentStaffId(),
  ]);
  // The (app) layout already admits only linked, active staff, so this is
  // near-unreachable — but surface a 404 (like /staff/[id]) rather than a blank
  // page if the record vanished mid-request.
  if (!user || !staffId) notFound();

  const [profile, history, pto] = await Promise.all([
    getStaffProfile(staffId),
    getStaffHistory(staffId),
    getStaffPto(staffId),
  ]);
  if (!profile) notFound();

  return (
    <ProfileView
      staffId={staffId}
      imageUrl={user.image ?? null}
      profile={profile}
      history={history}
      pto={pto}
      canEdit={true}
    />
  );
}
