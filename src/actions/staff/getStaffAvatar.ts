import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { staff, user } from "@/lib/db/schema";

/**
 * A staff member's avatar URL (their linked auth account's image), or null when
 * unlinked or no image. Separate from the profile read because the avatar lives
 * on the auth `user` row, not on `staff`.
 */
export async function getStaffAvatar(staffId: string): Promise<string | null> {
  const [row] = await db
    .select({ imageUrl: user.image })
    .from(staff)
    .leftJoin(user, eq(staff.userId, user.id))
    .where(eq(staff.id, staffId))
    .limit(1);

  return row?.imageUrl ?? null;
}
