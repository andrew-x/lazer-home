import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFeedbackAboutStaff } from "@/actions/feedback/getFeedbackAboutStaff";
import { getStaffReviewNotes } from "@/actions/performance/getStaffReviewNotes";
import { getStaffSelfEvaluations } from "@/actions/performance/getStaffSelfEvaluations";
import { getManualOfMe } from "@/actions/responses/getManualOfMe";
import { getWaysOfWorking } from "@/actions/responses/getWaysOfWorking";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getStaffHistory } from "@/actions/staff/getStaffHistory";
import { getStaffProfile } from "@/actions/staff/getStaffProfile";
import { getStaffProjects } from "@/actions/staff/getStaffProjects";
import { getStaffPto } from "@/actions/staff/getStaffPto";
import { ProfileView } from "@/components/staff/profile-view";
import { getCurrentUser } from "@/lib/auth/auth";

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

  // Own profile — always allowed to see own compensation. Feedback, review notes and
  // self-evaluations are NOT hard-coded like `canEdit`/`canViewCompensation` below:
  // seeing your own profile doesn't decide any of them. The reads do — you get the
  // limited recipient tier of your feedback, only the review notes your manager has
  // *shared* (a person is never their own note-manager), and full read/write on your
  // own self-evaluations (where being yourself is the *widest* answer, not the
  // narrowest — passing the read's answer is right either way).
  const [
    profile,
    projects,
    history,
    pto,
    manualOfMe,
    waysOfWorking,
    feedback,
    reviewNotes,
    selfEvaluations,
  ] = await Promise.all([
    getStaffProfile(staffId),
    getStaffProjects(staffId),
    getStaffHistory(staffId, true),
    getStaffPto(staffId),
    getManualOfMe(staffId),
    getWaysOfWorking(staffId),
    getFeedbackAboutStaff(staffId),
    getStaffReviewNotes(staffId),
    getStaffSelfEvaluations(staffId),
  ]);
  if (!profile) notFound();

  return (
    <ProfileView
      staffId={staffId}
      imageUrl={user.image ?? null}
      profile={profile}
      projects={projects}
      manualOfMe={manualOfMe}
      waysOfWorking={waysOfWorking}
      history={history}
      pto={pto}
      feedback={feedback}
      reviewNotes={reviewNotes}
      selfEvaluations={selfEvaluations}
      canEdit={true}
      canViewCompensation={true}
    />
  );
}
