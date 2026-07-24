import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCompanyEntries } from "@/actions/crm/entryViews";
import { getCompanyDetail } from "@/actions/crm/getCompanyDetail";
import { CompanyDetailView } from "@/components/crm/company-detail-view";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";

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
  const [company, entries, user] = await Promise.all([
    getCompanyDetail(id),
    getCompanyEntries(id),
    getCurrentUser(),
  ]);

  if (!company) notFound();

  const canEdit = user ? userHasPermission(user, { crm: ["edit"] }) : false;

  return (
    <CompanyDetailView
      company={company}
      notes={entries.notes}
      canEdit={canEdit}
    />
  );
}
