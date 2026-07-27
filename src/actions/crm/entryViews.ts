import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import {
  companyEntries,
  contactEntries,
  opportunityEntries,
  staff,
} from "@/lib/db/schema";

/**
 * A single note entry shaped for the client: author name resolved, timestamps as
 * epoch millis (serializable across the RSC boundary and matching the board-card
 * convention). `editedAt` is null unless the body was changed after creation.
 */
export type EntryView = {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: number;
  editedAt: number | null;
};

type EntryRow = {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toView(row: EntryRow): EntryView {
  const createdAt = row.createdAt.getTime();
  const updatedAt = row.updatedAt.getTime();
  return {
    id: row.id,
    body: row.body,
    authorName: row.authorName,
    createdAt,
    editedAt: updatedAt > createdAt ? updatedAt : null,
  };
}

/** One of the three near-identical entry tables. */
type EntryTable =
  | typeof companyEntries
  | typeof contactEntries
  | typeof opportunityEntries;

/** The parent FK column of one of those tables. */
type ParentColumn =
  | typeof companyEntries.companyId
  | typeof contactEntries.contactId
  | typeof opportunityEntries.opportunityId;

/**
 * Newest-first notes for one parent, with author names resolved. The three entry
 * tables are structurally identical apart from the parent FK's name, so a
 * representative cast (`companyEntries`) lets Drizzle infer the select while the
 * *real* table and parent column drive the runtime SQL.
 */
async function selectEntries(
  table: EntryTable,
  parentColumn: ParentColumn,
  parentId: string,
): Promise<EntryView[]> {
  const t = table as typeof companyEntries;
  const rows = await db
    .select({
      id: t.id,
      body: t.body,
      authorName: staff.name,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })
    .from(t)
    .leftJoin(staff, eq(t.authorStaffId, staff.id))
    .where(eq(parentColumn, parentId))
    .orderBy(desc(t.createdAt));
  return rows.map(toView);
}

/** Newest-first notes for a contact, with author names. */
export async function getContactEntries(
  contactId: string,
): Promise<EntryView[]> {
  return selectEntries(contactEntries, contactEntries.contactId, contactId);
}

/** Newest-first notes for an opportunity, with author names. */
export async function getOpportunityEntries(
  opportunityId: string,
): Promise<EntryView[]> {
  return selectEntries(
    opportunityEntries,
    opportunityEntries.opportunityId,
    opportunityId,
  );
}

/** Newest-first notes for a company, with author names. */
export async function getCompanyEntries(
  companyId: string,
): Promise<EntryView[]> {
  return selectEntries(companyEntries, companyEntries.companyId, companyId);
}
