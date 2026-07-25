import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import {
  companyEntries,
  contactEntries,
  opportunityEntries,
  staff,
} from "@/lib/db/schema";
import type { EntryKind } from "./entries.schema";

/**
 * A single note/next-step entry shaped for the client: author name resolved,
 * timestamps as epoch millis (serializable across the RSC boundary and matching
 * the board-card convention). `editedAt` is null unless the body was changed
 * after creation.
 */
export type EntryView = {
  id: string;
  kind: EntryKind;
  body: string;
  authorName: string | null;
  createdAt: number;
  editedAt: number | null;
};

/** A parent's entries split into the two logs the detail views render. */
export type EntryLogData = { notes: EntryView[]; nextSteps: EntryView[] };

type EntryRow = {
  id: string;
  kind: EntryKind;
  body: string;
  authorName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toLogData(rows: EntryRow[]): EntryLogData {
  const notes: EntryView[] = [];
  const nextSteps: EntryView[] = [];
  for (const row of rows) {
    const createdAt = row.createdAt.getTime();
    const updatedAt = row.updatedAt.getTime();
    const view: EntryView = {
      id: row.id,
      kind: row.kind,
      body: row.body,
      authorName: row.authorName,
      createdAt,
      editedAt: updatedAt > createdAt ? updatedAt : null,
    };
    (row.kind === "next_step" ? nextSteps : notes).push(view);
  }
  return { notes, nextSteps };
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
 * Newest-first notes & next steps for one parent, with author names resolved.
 * The three entry tables are structurally identical apart from the parent FK's
 * name, so a representative cast (`companyEntries`) lets Drizzle infer the
 * select while the *real* table and parent column drive the runtime SQL.
 */
async function selectEntries(
  table: EntryTable,
  parentColumn: ParentColumn,
  parentId: string,
): Promise<EntryLogData> {
  const t = table as typeof companyEntries;
  const rows = await db
    .select({
      id: t.id,
      kind: t.kind,
      body: t.body,
      authorName: staff.name,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })
    .from(t)
    .leftJoin(staff, eq(t.authorStaffId, staff.id))
    .where(eq(parentColumn, parentId))
    .orderBy(desc(t.createdAt));
  return toLogData(rows);
}

/** Newest-first notes & next steps for a contact, with author names. */
export async function getContactEntries(
  contactId: string,
): Promise<EntryLogData> {
  return selectEntries(contactEntries, contactEntries.contactId, contactId);
}

/** Newest-first notes & next steps for an opportunity, with author names. */
export async function getOpportunityEntries(
  opportunityId: string,
): Promise<EntryLogData> {
  return selectEntries(
    opportunityEntries,
    opportunityEntries.opportunityId,
    opportunityId,
  );
}

/** Newest-first notes & next steps for a company, with author names. */
export async function getCompanyEntries(
  companyId: string,
): Promise<EntryLogData> {
  return selectEntries(companyEntries, companyEntries.companyId, companyId);
}
