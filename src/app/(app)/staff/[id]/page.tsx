import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFeedbackAboutStaff } from "@/actions/feedback/getFeedbackAboutStaff";
import { getStaffReviewNotes } from "@/actions/performance/getStaffReviewNotes";
import { getStaffSelfEvaluations } from "@/actions/performance/getStaffSelfEvaluations";
import { getManualOfMe } from "@/actions/responses/getManualOfMe";
import { getWaysOfWorking } from "@/actions/responses/getWaysOfWorking";
import { canEditStaff } from "@/actions/staff/canEditStaff";
import { canViewCompensation } from "@/actions/staff/canViewCompensation";
import { getStaffAvatar } from "@/actions/staff/getStaffAvatar";
import { getStaffHistory } from "@/actions/staff/getStaffHistory";
import { getStaffProfile } from "@/actions/staff/getStaffProfile";
import { getStaffProjects } from "@/actions/staff/getStaffProjects";
import { getStaffPto } from "@/actions/staff/getStaffPto";
import { ProfileView } from "@/components/staff/profile-view";
import { getCurrentUser } from "@/lib/auth/auth";

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

  // `pto`, `feedback`, `reviewNotes` and `selfEvaluations` each come back null when
  // this viewer may not see that section — the reads are the gate, and ProfileView
  // just hides it.
  const [
    profile,
    projects,
    pto,
    imageUrl,
    user,
    manualOfMe,
    waysOfWorking,
    feedback,
    reviewNotes,
    selfEvaluations,
  ] = await Promise.all([
    getStaffProfile(id),
    getStaffProjects(id),
    getStaffPto(id),
    getStaffAvatar(id),
    getCurrentUser(),
    getManualOfMe(id),
    getWaysOfWorking(id),
    getFeedbackAboutStaff(id),
    getStaffReviewNotes(id),
    getStaffSelfEvaluations(id),
  ]);

  if (!profile) notFound();

  // UI affordances only — the actions/reads still enforce server-side.
  const [canEdit, canViewComp] = user
    ? await Promise.all([canEditStaff(user, id), canViewCompensation(user, id)])
    : [false, false];

  // Comp entries are gated at the read (history renders in a client component).
  const history = await getStaffHistory(id, canViewComp);

  return (
    <ProfileView
      staffId={id}
      imageUrl={imageUrl}
      profile={profile}
      projects={projects}
      manualOfMe={manualOfMe}
      waysOfWorking={waysOfWorking}
      history={history}
      pto={pto}
      feedback={feedback}
      reviewNotes={reviewNotes}
      selfEvaluations={selfEvaluations}
      canEdit={canEdit}
      canViewCompensation={canViewComp}
    />
  );
}
