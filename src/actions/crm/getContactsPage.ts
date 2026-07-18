import "server-only";

import { asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { companies, contactEntries, contacts } from "@/lib/db/schema";
import { CRM_PAGE_SIZE, clampPage, type Page } from "@/lib/pagination";

export type ContactRow = {
  id: string;
  firstName: string;
  lastName: string;
  role: string | null;
  companyId: string | null;
  companyName: string | null;
  /** Body of the most recent next-step entry, or null if the contact has none. */
  nextStep: string | null;
  /** When that next step was logged (epoch millis), or null. */
  nextStepAt: number | null;
};

/**
 * One page of contacts for the list table: name, company, role, and the most
 * recent next-step entry. Ordered by last then first name, company resolved via
 * a left join (optional). The latest next step comes from a `DISTINCT ON`
 * subquery over `contact_entries` (one row per contact, newest `next_step`
 * first), left-joined so contacts with no next step still appear. Server-side
 * paginated; `page` is clamped into range.
 */
export async function getContactsPage(
  page = 1,
  pageSize = CRM_PAGE_SIZE,
): Promise<Page<ContactRow>> {
  const [{ total }] = await db.select({ total: count() }).from(contacts);
  const { pageCount, safePage } = clampPage(total, page, pageSize);

  // Latest next-step per contact: DISTINCT ON keeps the first row per
  // `contactId` under the (contactId, createdAt desc) ordering.
  const latestNextStep = db
    .selectDistinctOn([contactEntries.contactId], {
      contactId: contactEntries.contactId,
      body: contactEntries.body,
      createdAt: contactEntries.createdAt,
    })
    .from(contactEntries)
    .where(eq(contactEntries.kind, "next_step"))
    .orderBy(contactEntries.contactId, desc(contactEntries.createdAt))
    .as("latest_next_step");

  const rows = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      role: contacts.role,
      companyId: contacts.companyId,
      companyName: companies.name,
      nextStep: latestNextStep.body,
      nextStepAt: latestNextStep.createdAt,
    })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.id))
    .leftJoin(latestNextStep, eq(latestNextStep.contactId, contacts.id))
    .orderBy(asc(contacts.lastName), asc(contacts.firstName))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  return {
    rows: rows.map((row) => ({
      ...row,
      nextStepAt: row.nextStepAt ? row.nextStepAt.getTime() : null,
    })),
    total,
    page: safePage,
    pageSize,
    pageCount,
  };
}
