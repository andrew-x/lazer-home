import "server-only";

import { asc, count, eq, inArray, type SQL } from "drizzle-orm";
import { citiesNear } from "@/lib/cities/cities";
import { CRM_PAGE_SIZE, clampPage, type Page } from "@/lib/core/pagination";
import { db } from "@/lib/db/db";
import { companies, contacts } from "@/lib/db/schema";
import { type OpenTaskSummary, openTasksByParent } from "./getTasks";

export type ContactRow = {
  id: string;
  firstName: string;
  lastName: string;
  role: string | null;
  location: string | null;
  companyId: string | null;
  companyName: string | null;
  /** The contact's open (not-done) tasks, oldest first — empty when none. */
  openTasks: OpenTaskSummary[];
};

/**
 * One page of contacts for the list table: name, company, role, and each
 * contact's open tasks. Ordered by last then first name, company resolved via a
 * left join (optional). Open tasks are fetched in one grouped query for the whole
 * page (see `openTasksByParent`). Server-side paginated; `page` is clamped into
 * range.
 */
/** Optional filters for the contacts list — a location (a "City, CC" label,
 * optionally expanded to nearby cities). */
export type ContactListFilters = {
  /** A "City, CC" label to match on `contacts.location`. */
  city?: string;
  /** When true, also match cities within the "nearby" radius of `city`. */
  nearby?: boolean;
};

/** Build the `where` for the given filters (undefined when none apply). */
function contactsWhere(filters: ContactListFilters): SQL | undefined {
  if (!filters.city) return undefined;
  const labels = filters.nearby ? citiesNear(filters.city) : [filters.city];
  return inArray(contacts.location, labels);
}

export async function getContactsPage(
  page = 1,
  filters: ContactListFilters = {},
  pageSize = CRM_PAGE_SIZE,
): Promise<Page<ContactRow>> {
  const where = contactsWhere(filters);

  const [{ total }] = await db
    .select({ total: count() })
    .from(contacts)
    .where(where);
  const { pageCount, safePage } = clampPage(total, page, pageSize);

  const rows = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      role: contacts.role,
      location: contacts.location,
      companyId: contacts.companyId,
      companyName: companies.name,
    })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.id))
    .where(where)
    .orderBy(asc(contacts.lastName), asc(contacts.firstName))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  const openTasks = await openTasksByParent(
    "contact",
    rows.map((row) => row.id),
  );

  return {
    rows: rows.map((row) => ({
      ...row,
      openTasks: openTasks.get(row.id) ?? [],
    })),
    total,
    page: safePage,
    pageSize,
    pageCount,
  };
}
