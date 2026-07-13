import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCompanyDetail } from "@/actions/crm/getCompanyDetail";
import { CompanyDetailView } from "@/components/crm/company-detail-view";

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
  const company = await getCompanyDetail(id);

  if (!company) notFound();

  return <CompanyDetailView company={company} />;
}
