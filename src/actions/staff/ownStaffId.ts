import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";

/**
 * The staff id linked to a user account, or null when no staff record is linked.
 * The single low-level "user → own staff" lookup behind the ownership checks
 * (`canEditStaff`, `canViewCompensation`, `canEditTimesheet`), `getCurrentStaffId`,
 * and the feedback gate — so the query lives in exactly one place.
 *
 * Pass `activeOnly` to additionally require the linked record be active (the
 * feedback gate needs an *active* caller; the ownership checks don't care).
 */
export async function ownStaffId(
  userId: string,
  { activeOnly = false }: { activeOnly?: boolean } = {},
): Promise<string | null> {
  const [row] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(
      activeOnly
        ? and(eq(staff.userId, userId), eq(staff.isActive, true))
        : eq(staff.userId, userId),
    )
    .limit(1);

  return row?.id ?? null;
}
