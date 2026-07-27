import "server-only";

import { eq, type InferInsertModel } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertRowExists } from "@/actions/shared/assertRowExists";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { isForeignKeyViolation } from "@/lib/db/foreign-key-violation";
import { generateId } from "@/lib/db/ids";
import {
  companyEntries,
  contactEntries,
  opportunityEntries,
} from "@/lib/db/schema";
import { resolveAuthorStaffId } from "./resolveAuthorStaffId";
import { revalidateCompany, revalidateContact } from "./revalidate";

/**
 * The three CRM entry logs — company, contact, opportunity — are backed by
 * structurally identical tables that differ only in their parent FK column, id
 * prefix, and which pages a write revalidates. This module holds the single
 * add/update/delete core they share; the nine `'use server'` action files are
 * thin wrappers that pick a descriptor and forward their parsed input, and the
 * read side lives in `entryViews.ts` (`selectEntries`).
 */

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
 * Everything the three entry families differ by. `parentColumn` guards the row
 * on update/delete (and yields the parent id for `revalidate`); `parentKey` is
 * the same FK as a JS insert key; `entity` names the parent in the
 * FK-violation message; `revalidate` refreshes the pages that render the log.
 */
export type EntryMutationDescriptor = {
  table: EntryTable;
  parentColumn: ParentColumn;
  parentKey: "companyId" | "contactId" | "opportunityId";
  idPrefix: string;
  entity: string;
  revalidate: (parentId: string) => void;
};

// The three tables are structurally identical apart from the parent FK's name,
// so a representative cast (`companyEntries`) lets Drizzle infer the builders
// cleanly while the *real* table and columns from the descriptor drive the
// runtime SQL. The dynamic parent key and union-of-tables would otherwise defeat
// per-table inference.

export const companyEntryMutations: EntryMutationDescriptor = {
  table: companyEntries,
  parentColumn: companyEntries.companyId,
  parentKey: "companyId",
  idPrefix: "coentry",
  entity: "company",
  revalidate: revalidateCompany,
};

export const contactEntryMutations: EntryMutationDescriptor = {
  table: contactEntries,
  parentColumn: contactEntries.contactId,
  parentKey: "contactId",
  idPrefix: "centry",
  entity: "contact",
  revalidate: revalidateContact,
};

export const opportunityEntryMutations: EntryMutationDescriptor = {
  table: opportunityEntries,
  parentColumn: opportunityEntries.opportunityId,
  parentKey: "opportunityId",
  idPrefix: "oentry",
  entity: "opportunity",
  // Opportunities render in a drawer on the list page — there's no
  // `/opportunities/[id]` route — so the list is the only page to revalidate.
  revalidate: () => revalidatePath("/opportunities"),
};

/**
 * Append a timestamped note entry to a parent's log. The author is resolved
 * server-side from the session (never trusted from the client); the parent FK is
 * guarded by the DB, so a bad id surfaces as a clean error rather than a dangling
 * row.
 */
export async function addEntry(
  descriptor: EntryMutationDescriptor,
  input: { parentId: string; body: string },
  user: { id: string; email: string },
): Promise<{ id: string }> {
  const authorStaffId = await resolveAuthorStaffId(user);
  const entryId = generateId(descriptor.idPrefix);
  const table = descriptor.table as typeof companyEntries;
  try {
    // The computed parent key (`[descriptor.parentKey]`) over the union of the
    // three structurally-identical tables can't be narrowed to one table's
    // insert shape, so the literal is bridged through `unknown` — the same
    // representative-table escape the module comment above describes. The
    // runtime values are correct; only static inference needs the nudge.
    const values = {
      id: entryId,
      [descriptor.parentKey]: input.parentId,
      body: input.body,
      authorStaffId,
    } as unknown as InferInsertModel<typeof companyEntries>;
    await db.insert(table).values(values);
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new UserSafeActionError(
        `That ${descriptor.entity} no longer exists.`,
      );
    }
    throw error;
  }

  descriptor.revalidate(input.parentId);
  return { id: entryId };
}

/**
 * Edit the body of an existing entry. Only the body changes; `.returning()`
 * guards against the row being deleted mid-edit and yields the parent id for
 * revalidation.
 */
export async function updateEntryBody(
  descriptor: EntryMutationDescriptor,
  input: { id: string; body: string },
): Promise<{ id: string }> {
  const table = descriptor.table as typeof companyEntries;
  const rows = await db
    .update(table)
    .set({ body: input.body })
    .where(eq(table.id, input.id))
    .returning({
      parentId: descriptor.parentColumn as typeof companyEntries.companyId,
    });
  assertRowExists(rows, "entry");

  descriptor.revalidate(rows[0].parentId);
  return { id: input.id };
}

/**
 * Delete an entry. `.returning()` confirms the row existed and yields the
 * parent id for revalidation.
 */
export async function deleteEntry(
  descriptor: EntryMutationDescriptor,
  input: { id: string },
): Promise<{ id: string }> {
  const table = descriptor.table as typeof companyEntries;
  const rows = await db
    .delete(table)
    .where(eq(table.id, input.id))
    .returning({
      parentId: descriptor.parentColumn as typeof companyEntries.companyId,
    });
  assertRowExists(rows, "entry");

  descriptor.revalidate(rows[0].parentId);
  return { id: input.id };
}
