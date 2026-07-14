import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getContactDetail } from "@/actions/crm/getContactDetail";
import { ContactDetailView } from "@/components/crm/contact-detail-view";
import { contactName } from "@/lib/contact-name";

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
  const contact = await getContactDetail(id);

  if (!contact) notFound();

  return <ContactDetailView contact={contact} />;
}
