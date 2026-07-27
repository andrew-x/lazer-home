import "server-only";

import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { getCurrentStaffId } from "./getCurrentStaffId";

/** The signed-in user's own staff `{ id, name }`, shaped for an entity picker. */
export type StaffIdentity = { id: string; name: string };

/**
 * The signed-in user's linked staff id + name, or null when unauthenticated or no
 * staff record is linked. Used to prefill the task composer's owner picker with
 * the current user (the default owner). Wrapped in `React.cache` so callers within
 * one render share the lookup; builds on {@link getCurrentStaffId}.
 */
export const getCurrentStaffIdentity = cache(
  async (): Promise<StaffIdentity | null> => {
    const staffId = await getCurrentStaffId();
    if (!staffId) return null;

    const [row] = await db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .where(eq(staff.id, staffId))
      .limit(1);
    return row ?? null;
  },
);
