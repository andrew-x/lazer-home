import "server-only";

import { asc, count, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { contactNameSql } from "@/actions/shared/contactName";
import { db } from "@/lib/db/db";
import { companies, contacts } from "@/lib/db/schema";
import { CRM_PAGE_SIZE, clampPage, type Page } from "@/lib/pagination";

export type ContactRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: string | null;
  companyId: string | null;
  companyName: string | null;
  linkedinUrl: string | null;
  managerId: string | null;
  managerName: string | null;
};

/**
 * One page of contacts, ordered by last then first name, with the contact's
 * company name resolved via a left join (company is optional) and its manager's
 * name via a self-join on `contacts` (manager is optional too). Server-side
 * paginated like companies; `page` is clamped into range.
 */
export async function getContactsPage(
  page = 1,
  pageSize = CRM_PAGE_SIZE,
): Promise<Page<ContactRow>> {
  const [{ total }] = await db.select({ total: count() }).from(contacts);
  const { pageCount, safePage } = clampPage(total, page, pageSize);

  const managers = alias(contacts, "managers");

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
      linkedinUrl: contacts.linkedinUrl,
      managerId: contacts.managerId,
      managerName: contactNameSql<string | null>(managers),
    })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.id))
    .leftJoin(managers, eq(contacts.managerId, managers.id))
    .orderBy(asc(contacts.lastName), asc(contacts.firstName))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  return { rows, total, page: safePage, pageSize, pageCount };
}
