import "server-only";

import { and, asc, eq, ilike, ne } from "drizzle-orm";
import { escapeLike } from "@/lib/core/like";
import { SEARCH_LIMIT } from "@/lib/core/search";
import { db } from "@/lib/db/db";
import { companies, staff } from "@/lib/db/schema";

/**
 * Shared type-ahead query bodies for the entity pickers. The *query* (tables,
 * columns, filters) is identical wherever a staff or company picker appears; only
 * the permission gate differs per caller. So the query lives here once and each
 * domain's search action wraps it with its own `metadata.permission`. Kept inside
 * `src/actions/**` so `db` access stays in the actions layer (see database rule).
 *
 * A blank query returns nothing (search only runs once the user types).
 */

/**
 * Active staff whose name matches `query`, as `{ id, name }` (capped). Pass
 * `excludeId` to drop a specific staff row (e.g. the caller, for self-exclusion).
 */
export async function searchStaffByName(
  query: string,
  { excludeId }: { excludeId?: string } = {},
) {
  if (query === "") return [];

  return db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(
      and(
        eq(staff.isActive, true),
        ilike(staff.name, `%${escapeLike(query)}%`),
        excludeId ? ne(staff.id, excludeId) : undefined,
      ),
    )
    .orderBy(asc(staff.name))
    .limit(SEARCH_LIMIT);
}

/** Companies whose name matches `query`, as `{ id, name }` (capped). */
export async function searchCompaniesByName(query: string) {
  if (query === "") return [];

  return db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(ilike(companies.name, `%${escapeLike(query)}%`))
    .orderBy(asc(companies.name))
    .limit(SEARCH_LIMIT);
}
