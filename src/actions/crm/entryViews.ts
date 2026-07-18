import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { contactEntries, opportunityEntries, staff } from "@/lib/db/schema";
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

/** Newest-first notes & next steps for a contact, with author names. */
export async function getContactEntries(
  contactId: string,
): Promise<EntryLogData> {
  const rows = await db
    .select({
      id: contactEntries.id,
      kind: contactEntries.kind,
      body: contactEntries.body,
      authorName: staff.name,
      createdAt: contactEntries.createdAt,
      updatedAt: contactEntries.updatedAt,
    })
    .from(contactEntries)
    .leftJoin(staff, eq(contactEntries.authorStaffId, staff.id))
    .where(eq(contactEntries.contactId, contactId))
    .orderBy(desc(contactEntries.createdAt));
  return toLogData(rows);
}

/** Newest-first notes & next steps for an opportunity, with author names. */
export async function getOpportunityEntries(
  opportunityId: string,
): Promise<EntryLogData> {
  const rows = await db
    .select({
      id: opportunityEntries.id,
      kind: opportunityEntries.kind,
      body: opportunityEntries.body,
      authorName: staff.name,
      createdAt: opportunityEntries.createdAt,
      updatedAt: opportunityEntries.updatedAt,
    })
    .from(opportunityEntries)
    .leftJoin(staff, eq(opportunityEntries.authorStaffId, staff.id))
    .where(eq(opportunityEntries.opportunityId, opportunityId))
    .orderBy(desc(opportunityEntries.createdAt));
  return toLogData(rows);
}
