import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
  const [plan, pto, user] = await Promise.all([
    getProjectPlan(id),
    getProjectPto(id),
    getCurrentUser(),
  ]);

  if (!plan) notFound();

  // Drives the page's edit affordances only — every mutation carries its own
  // `projects.edit` gate in the action's metadata.
  const canEdit = user
    ? userHasPermission(user, { projects: ["edit"] })
    : false;

  return <ProjectDetailView plan={plan} pto={pto} canEdit={canEdit} />;
}
