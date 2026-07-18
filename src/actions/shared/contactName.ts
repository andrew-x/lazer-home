import "server-only";

import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * The SQL-side counterpart to `contactName` in `src/lib/contact-name.ts`: the
 * `"First Last"` display convention as a Drizzle expression, so every read that
 * projects a contact's name in the database composes it the same way (and a
 * change to the convention lands in one place). Pass the `contacts` table — or a
 * self-join alias of it (e.g. the manager alias) — and select the result.
 *
 * Left-joined aliases can be absent, so the value is nullable at the type level:
 * call as `contactNameSql<string | null>(managers)` there; the default `string`
 * suits inner-joined contacts.
 */
export function contactNameSql<T extends string | null = string>(table: {
  firstName: AnyPgColumn;
  lastName: AnyPgColumn;
}) {
  return sql<T>`${table.firstName} || ' ' || ${table.lastName}`;
}
