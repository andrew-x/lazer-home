import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCompanyDetail } from "@/actions/crm/getCompanyDetail";
import { CompanyDetailView } from "@/components/crm/company-detail-view";
import { getCurrentUser } from "@/lib/auth";
import { userHasPermission } from "@/lib/permissions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const company = await getCompanyDetail(id);
  return { title: company?.name ?? "Company" };
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [company, user] = await Promise.all([
    getCompanyDetail(id),
    getCurrentUser(),
  ]);

  if (!company) notFound();

  const canEdit = user ? userHasPermission(user, { crm: ["edit"] }) : false;

  return <CompanyDetailView company={company} canEdit={canEdit} />;
}
