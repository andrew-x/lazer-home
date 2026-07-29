import "server-only";

import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { citiesNear } from "@/lib/cities/cities";
import { escapeLike } from "@/lib/core/like";
import { CRM_PAGE_SIZE, clampPage, type Page } from "@/lib/core/pagination";
import { contactName } from "@/lib/crm/contact-name";
import { db } from "@/lib/db/db";
import { companies, contactRelationships, contacts } from "@/lib/db/schema";
import { type OpenTaskSummary, openTasksByParent } from "./getTasks";

/**
 * The newer record for the same person, when this contact has been superseded —
 * so an inactive row in the list can point at where they went instead of being a
 * dead end. Only ever set for an inactive contact in practice.
 */
export type ContactRowSuccessor = {
  id: string;
  name: string;
  companyName: string | null;
};

export type ContactRow = {
  id: string;
  firstName: string;
  lastName: string;
  role: string | null;
  location: string | null;
  companyId: string | null;
  companyName: string | null;
  /** False for an inactive contact — drives the "Inactive" badge in the name cell. */
  isActive: boolean;
  /** Where this person went, when a successor record exists — else null. */
  successor: ContactRowSuccessor | null;
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
/** Optional filters for the contacts list — a name search and a location (a
 * "City, CC" label, optionally expanded to nearby cities). */
export type ContactListFilters = {
  /** Free-text name search, matched case-insensitively (see `contactsWhere`). */
  query?: string;
  /** A "City, CC" label to match on `contacts.location`. */
  city?: string;
  /** When true, also match cities within the "nearby" radius of `city`. */
  nearby?: boolean;
  /**
   * Include inactive contacts. Off by default: the list is "the people we deal
   * with", and a contact superseded by a newer record would otherwise show up
   * twice. Unlike the other filters this one *widens* the result set. Matches
   * `searchContacts`' arg of the same name.
   */
  includeInactive?: boolean;
};

/** Build the `where` for the given filters (undefined when none apply). */
function contactsWhere(filters: ContactListFilters): SQL | undefined {
  const conditions: SQL[] = [];

  const query = filters.query?.trim();
  if (query) {
    // Escaped so `%`/`_` in the term match literally. Matching the joined
    // "First Last" as well as each part means "jane sm" finds Jane Smith; both
    // name columns are notNull, so the concatenation is never null.
    const term = `%${escapeLike(query)}%`;
    const nameMatch = or(
      ilike(contacts.firstName, term),
      ilike(contacts.lastName, term),
      ilike(sql`${contacts.firstName} || ' ' || ${contacts.lastName}`, term),
    );
    if (nameMatch) conditions.push(nameMatch);
  }

  if (filters.city) {
    const labels = filters.nearby ? citiesNear(filters.city) : [filters.city];
    conditions.push(inArray(contacts.location, labels));
  }

  // Hidden unless asked for. This feeds both the `count()` and the row query, so
  // `total`/`pageCount` follow the toggle automatically.
  if (!filters.includeInactive) {
    conditions.push(eq(contacts.isActive, true));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * For each of the given contacts, the newer record that succeeds it — keyed by the
 * *predecessor's* id, so an inactive row can render "Moved to …".
 *
 * One grouped query for the whole page rather than a join on the row query,
 * mirroring `openTasksByParent`: it keeps the paginated `count()`/rows pair free of
 * a second relationship join, and the map lookup is what the row assembly wants
 * anyway. `..._one_successor_uq` guarantees at most one successor per predecessor,
 * so a flat map is the right shape.
 */
async function successorsByPredecessor(
  predecessorIds: string[],
): Promise<Map<string, ContactRowSuccessor>> {
  if (predecessorIds.length === 0) return new Map();

  const newer = alias(contacts, "successor_contacts");
  const rows = await db
    .select({
      predecessorId: contactRelationships.relatedContactId,
      id: newer.id,
      firstName: newer.firstName,
      lastName: newer.lastName,
      companyName: companies.name,
    })
    .from(contactRelationships)
    .innerJoin(newer, eq(contactRelationships.contactId, newer.id))
    .leftJoin(companies, eq(newer.companyId, companies.id))
    .where(
      and(
        eq(contactRelationships.kind, "succeeds"),
        inArray(contactRelationships.relatedContactId, predecessorIds),
      ),
    );

  return new Map(
    rows.map((row) => [
      row.predecessorId,
      {
        id: row.id,
        name: contactName(row),
        companyName: row.companyName,
      },
    ]),
  );
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
      isActive: contacts.isActive,
    })
    .from(contacts)
    .leftJoin(companies, eq(contacts.companyId, companies.id))
    .where(where)
    .orderBy(asc(contacts.lastName), asc(contacts.firstName))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  const pageIds = rows.map((row) => row.id);
  const [openTasks, successors] = await Promise.all([
    openTasksByParent("contact", pageIds),
    successorsByPredecessor(pageIds),
  ]);

  return {
    rows: rows.map((row) => ({
      ...row,
      successor: successors.get(row.id) ?? null,
      openTasks: openTasks.get(row.id) ?? [],
    })),
    total,
    page: safePage,
    pageSize,
    pageCount,
  };
}
