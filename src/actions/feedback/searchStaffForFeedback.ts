"use server";

import { and, asc, eq, ilike, ne } from "drizzle-orm";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { escapeLike } from "@/lib/like";
import { SEARCH_LIMIT, searchQuerySchema } from "@/lib/search";

/**
 * Type-ahead search for the feedback recipient picker: active staff matching the
 * query, excluding the caller (no self-feedback). Auth-only — no capability gate,
 * because giving feedback is open to any signed-in staff (and the staff directory
 * is already readable by all signed-in users). A blank query returns nothing.
 */
export const searchStaffForFeedback = secureActionClient
  .metadata({ action: "search-staff-for-feedback" })
  .inputSchema(searchQuerySchema)
  .action(async ({ parsedInput: { query } }) => {
    if (query === "") return [];

    const selfStaffId = await getCurrentStaffId();
    const conditions = [
      eq(staff.isActive, true),
      ilike(staff.name, `%${escapeLike(query)}%`),
    ];
    if (selfStaffId) conditions.push(ne(staff.id, selfStaffId));

    return db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .where(and(...conditions))
      .orderBy(asc(staff.name))
      .limit(SEARCH_LIMIT);
  });
