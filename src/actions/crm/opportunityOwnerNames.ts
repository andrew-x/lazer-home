import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { opportunityOwners, staff } from "@/lib/db/schema";

/**
 * Owner names for a set of opportunities, as `opportunityId → names[]`, in a
 * single grouped query (no N+1). Shared by the board read and the list read so
 * the join lives in one place. Names come back alphabetically; opportunities
 * with no owners are simply absent from the map (callers default to `[]`).
 */
export async function resolveOwnerNames(
  opportunityIds: string[],
): Promise<Map<string, string[]>> {
  const byOpportunity = new Map<string, string[]>();
  if (opportunityIds.length === 0) return byOpportunity;

  const rows = await db
    .select({
      opportunityId: opportunityOwners.opportunityId,
      name: staff.name,
    })
    .from(opportunityOwners)
    .innerJoin(staff, eq(opportunityOwners.staffId, staff.id))
    .where(inArray(opportunityOwners.opportunityId, opportunityIds))
    .orderBy(asc(staff.name));

  for (const { opportunityId, name } of rows) {
    const list = byOpportunity.get(opportunityId) ?? [];
    list.push(name);
    byOpportunity.set(opportunityId, list);
  }
  return byOpportunity;
}
