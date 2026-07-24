import type { Metadata } from "next";
import { getContactsPage } from "@/actions/crm/getContactsPage";
import { AddContactDialog } from "@/components/crm/add-contact-dialog";
import { ContactsListFilters } from "@/components/crm/contacts-list-filters";
import { ContactsTable } from "@/components/crm/contacts-table";
import { PaginationControls } from "@/components/pagination-controls";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { parsePage } from "@/lib/core/pagination";

export const metadata: Metadata = { title: "Contacts" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const city = typeof params.city === "string" ? params.city : undefined;
  const nearby = params.nearby === "1";

  const [contacts, user] = await Promise.all([
    getContactsPage(parsePage(params.contactsPage), { city, nearby }),
    getCurrentUser(),
  ]);

  const canEdit = user ? userHasPermission(user, { crm: ["edit"] }) : false;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            Contacts
          </h2>
          <p className="text-sm text-muted-foreground">
            The people at the companies we work with.
          </p>
        </div>
        {canEdit ? <AddContactDialog /> : null}
      </header>

      <section className="flex flex-col gap-3">
        <ContactsListFilters params={params} />
        <div className="rounded-md border">
          <ContactsTable rows={contacts.rows} filtered={city !== undefined} />
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
