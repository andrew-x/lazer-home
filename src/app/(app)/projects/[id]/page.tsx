import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProjectPlan } from "@/actions/projects/getProjectPlan";
import { getProjectPto } from "@/actions/projects/getProjectPto";
import { ProjectDetailView } from "@/components/projects/detail/project-detail-view";

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
  const [plan, pto] = await Promise.all([
    getProjectPlan(id),
    getProjectPto(id),
  ]);

  if (!plan) notFound();

  return <ProjectDetailView plan={plan} pto={pto} />;
}
