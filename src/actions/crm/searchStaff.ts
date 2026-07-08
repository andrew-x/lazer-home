"use server";

import { and, asc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { staff } from "@/lib/db/schema";
import { escapeLike } from "@/lib/like";

/**
 * Type-ahead search for the opportunity form's staff pickers (owners, referral
 * staff). Matches active staff by name; returns up to 10 `{ id, name }` for a
 * non-blank query (blank → nothing). Gated on `crm.edit` — stricter than the
 * open staff directory read, so it can't enumerate the roster past the write gate.
 */
const searchStaffSchema = z.object({ query: z.string() });

export const searchStaff = secureActionClient
  .metadata({
    action: "search-staff",
    permission: { crm: ["edit"] },
  })
  .inputSchema(searchStaffSchema)
  .action(async ({ parsedInput: { query } }) => {
    const trimmed = query.trim();
    if (trimmed === "") return [];

    return db
      .select({ id: staff.id, name: staff.name })
      .from(staff)
      .where(
        and(
          eq(staff.isActive, true),
          ilike(staff.name, `%${escapeLike(trimmed)}%`),
        ),
      )
      .orderBy(asc(staff.name))
      .limit(10);
  });
