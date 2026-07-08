"use server";

import { and, asc, eq, ilike } from "drizzle-orm";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { escapeLike } from "@/lib/like";
import { SEARCH_LIMIT, searchQuerySchema } from "@/lib/search";

/**
 * Type-ahead search for the opportunity form's staff pickers (owners, referral
 * staff). Matches active staff by name; returns up to `SEARCH_LIMIT`
 * `{ id, name }` for a non-blank query (blank → nothing). Gated on `crm.edit` —
 * stricter than the open staff directory read, so it can't enumerate the roster
 * past the write gate.
 */
export const searchStaff = secureActionClient
  .metadata({
    action: "search-staff",
    permission: { crm: ["edit"] },
  })
  .inputSchema(searchQuerySchema)
  .action(async ({ parsedInput: { query } }) => {
    if (query === "") return [];

    return db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .where(
        and(
          eq(staff.isActive, true),
          ilike(staff.name, `%${escapeLike(query)}%`),
        ),
      )
      .orderBy(asc(staff.name))
      .limit(SEARCH_LIMIT);
  });
