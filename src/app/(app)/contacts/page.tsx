import type { Metadata } from "next";
import { getContactsPage } from "@/actions/crm/getContactsPage";
import { AddContactDialog } from "@/components/crm/add-contact-dialog";
import { ContactsTable } from "@/components/crm/contacts-table";
import { PaginationControls } from "@/components/pagination-controls";
import { getCurrentUser } from "@/lib/auth";
import { parsePage } from "@/lib/pagination";
import { userHasPermission } from "@/lib/permissions";

export const metadata: Metadata = { title: "Contacts" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const [contacts, user] = await Promise.all([
    getContactsPage(parsePage(params.contactsPage)),
    getCurrentUser(),
  ]);

  const canEdit = user ? userHasPermission(user, { crm: ["edit"] }) : false;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-10">
      <header>
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          Contacts
        </h2>
        <p className="text-sm text-muted-foreground">
          The people at the companies we work with.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-heading text-base font-semibold tracking-tight">
            All contacts
          </h3>
          {canEdit ? <AddContactDialog /> : null}
        </div>
        <div className="rounded-md border">
          <ContactsTable rows={contacts.rows} />
          <PaginationControls
            basePath="/contacts"
            params={params}
            paramKey="contactsPage"
            page={contacts.page}
            pageCount={contacts.pageCount}
          />
        </div>
      </section>
    </div>
  );
}
