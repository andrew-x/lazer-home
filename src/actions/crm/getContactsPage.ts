import "server-only";

import { asc, count, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { companies, contacts } from "@/lib/db/schema";

export const CONTACTS_PAGE_SIZE = 20;

export type ContactRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: string | null;
  companyId: string | null;
  companyName: string | null;
};

export type ContactsPage = {
  rows: ContactRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/**
 * One page of contacts, ordered by last then first name, with the contact's
 * company name resolved via a left join (company is optional). Server-side
 * paginated like companies; `page` is clamped into range.
 */
export async function getContactsPage(
  page = 1,
  pageSize = CONTACTS_PAGE_SIZE,
): Promise<ContactsPage> {
  const [{ total }] = await db.select({ total: count() }).from(contacts);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);

  const rows = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
      role: contacts.role,
      companyId: contacts.companyId,
      companyName: companies.name,
    })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.id))
    .orderBy(asc(contacts.lastName), asc(contacts.firstName))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  return { rows, total, page: safePage, pageSize, pageCount };
}
