import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getContactDetail } from "@/actions/crm/getContactDetail";
import { ContactDetailView } from "@/components/crm/contact-detail-view";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { contactName } from "@/lib/crm/contact-name";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const contact = await getContactDetail(id);
  return {
    title: contact ? contactName(contact) : "Contact",
  };
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [contact, user] = await Promise.all([
    getContactDetail(id),
    getCurrentUser(),
  ]);

  if (!contact) notFound();

  const canEdit = user ? userHasPermission(user, { crm: ["edit"] }) : false;

  return <ContactDetailView contact={contact} canEdit={canEdit} />;
}
