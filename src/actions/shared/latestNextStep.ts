import "server-only";

import { desc, eq } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { contactEntries } from "@/lib/db/crm-schema";
import { db } from "@/lib/db/db";
import type { opportunityEntries } from "@/lib/db/opportunities-schema";

/**
 * The two CRM entry tables that carry a `next_step` log. They share the exact
 * column shape (`kind`/`body`/`createdAt`) and differ only in their parent FK, so
 * the subquery below is parameterized over this union. Typing the parameter as the
 * concrete union (rather than a generic `PgTable & {...}` constraint) is what keeps
 * `body`/`createdAt` resolving to their real `string`/`Date` types downstream.
 */
type CrmEntryTable = typeof contactEntries | typeof opportunityEntries;

/**
 * "Latest next-step per parent" as a reusable Drizzle subquery. Both
 * `contactEntries` and `opportunityEntries` carry a `next_step` log (same shape,
 * different parent FK), and three CRM reads want the newest one per parent —
 * contacts (list + company detail) and opportunities (board). `DISTINCT ON`
 * keeps the first row per parent under the `(parentId, createdAt desc)` ordering,
 * i.e. the most recent `next_step`. Left-join the result on `parentId` so parents
 * with no next step still appear.
 *
 * Pass the entry table and its parent-id column; `kind`/`body`/`createdAt` are
 * read off the table (both entry tables share them). The parent id is projected
 * under the generic key `parentId` — the emitted SQL is byte-identical to naming
 * it `contactId`/`opportunityId`, because the column alias derives from the
 * snake_case column name, not the JS key. Aliased `latest_next_step`.
 */
export function latestNextStepSubquery(
  entryTable: CrmEntryTable,
  parentId: AnyPgColumn,
) {
  return db
    .selectDistinctOn([parentId], {
      parentId,
      body: entryTable.body,
      createdAt: entryTable.createdAt,
    })
    .from(entryTable)
    .where(eq(entryTable.kind, "next_step"))
    .orderBy(parentId, desc(entryTable.createdAt))
    .as("latest_next_step");
}

/**
 * Map a nullable timestamp to epoch millis for the client. The `latest_next_step`
 * subquery yields a nullable `createdAt` (left join), which the CRM reads surface
 * as `nextStepAt: number | null`.
 */
export function toEpochMillis(date: Date | null): number | null {
  return date ? date.getTime() : null;
}
