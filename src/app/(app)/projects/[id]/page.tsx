import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProjectDeliveryNotes } from "@/actions/projects/getProjectDeliveryNotes";
import { getProjectPlan } from "@/actions/projects/getProjectPlan";
import { getProjectPto } from "@/actions/projects/getProjectPto";
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
  const [plan, pto, notes, user] = await Promise.all([
    getProjectPlan(id),
    getProjectPto(id),
    getProjectDeliveryNotes(id),
    getCurrentUser(),
  ]);

  if (!plan) notFound();

  // Drives the page's edit affordances only — every mutation carries its own
  // `projects.edit` gate in the action's metadata.
  const canEdit = user
    ? userHasPermission(user, { projects: ["edit"] })
    : false;

  return (
    <ProjectDetailView plan={plan} pto={pto} notes={notes} canEdit={canEdit} />
  );
}
