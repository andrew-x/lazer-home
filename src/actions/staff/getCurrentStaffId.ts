import "server-only";

import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";

/**
 * The signed-in user's linked staff id, or null when unauthenticated or no staff
 * record is linked to the account. Reused by the `getMy*` reads and the `/profile`
 * page (which needs the id to pass into the now-parameterized edit dialogs).
 */
export async function getCurrentStaffId(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const [row] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.userId, user.id))
    .limit(1);

  return row?.id ?? null;
}
