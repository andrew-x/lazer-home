"use server";

import { searchStaffByName } from "@/actions/shared/entitySearch";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { secureActionClient } from "@/lib/core/action";
import { searchQuerySchema } from "@/lib/core/search";

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
    return searchStaffByName(query, { excludeId: selfStaffId ?? undefined });
  });
