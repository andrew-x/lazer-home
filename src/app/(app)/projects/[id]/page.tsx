import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isDriveConfigured } from "@/actions/drive/driveApi";
import { getProjectDeliveryNotes } from "@/actions/projects/getProjectDeliveryNotes";
import { getProjectPlan } from "@/actions/projects/getProjectPlan";
import { getProjectPto } from "@/actions/projects/getProjectPto";
import { isSlackConfigured } from "@/actions/slack/slackApi";
import { getCurrentStaffIdentity } from "@/actions/staff/getCurrentStaffIdentity";
import { ProjectDetailView } from "@/components/projects/detail/project-detail-view";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const plan = await getProjectPlan(id);
  return { title: plan?.project.name ?? "Project" };
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Delivery notes are a sibling read rather than part of `getProjectPlan`, the
  // same way PTO is: `generateMetadata` above calls the plan read too, so anything
  // folded into it is fetched twice per request just to title the tab — and
  // `ProjectDetailPlan` is shared with the opportunity drawer's planner, which has
  // no notes to show.
  const [plan, pto, notes, user, currentStaff] = await Promise.all([
    getProjectPlan(id),
    getProjectPto(id),
    getProjectDeliveryNotes(id),
    getCurrentUser(),
    // Defaults the Slack create dialog's invite list to the viewer.
    getCurrentStaffIdentity(),
  ]);

  if (!plan) notFound();

  // Drives the page's edit affordances only — every mutation carries its own
  // `projects.edit` gate in the action's metadata.
  const canEdit = user
    ? userHasPermission(user, { projects: ["edit"] })
    : false;

  return (
    <ProjectDetailView
      plan={plan}
      pto={pto}
      notes={notes}
      canEdit={canEdit}
      // Reads one env var. The Slack channel already on `plan` renders straight
      // away; only the *suggestion* costs a round-trip, and that runs client-side
      // after this page has painted.
      slackEnabled={isSlackConfigured()}
      // Also just env vars. The Files tab's own contents are loaded client-side
      // when the tab is opened, so this page gains no Drive round-trip.
      driveEnabled={isDriveConfigured()}
      currentStaff={currentStaff}
    />
  );
}
