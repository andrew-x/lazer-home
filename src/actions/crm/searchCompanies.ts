"use server";

import { asc, ilike } from "drizzle-orm";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { companies } from "@/lib/db/schema";
import { escapeLike } from "@/lib/like";
import { SEARCH_LIMIT, searchQuerySchema } from "@/lib/search";

/**
 * Type-ahead search for the contact form's company picker. Returns up to
 * `SEARCH_LIMIT` name matches for a non-blank query; a blank query returns
 * nothing (search only runs once the user types). Gated on `crm.edit` — the same
 * capability the contact picker is behind — so it can't be used to enumerate the
 * company roster past the page-level gate.
 */
export const searchCompanies = secureActionClient
  .metadata({
    action: "search-companies",
    permission: { crm: ["edit"] },
  })
  .inputSchema(searchQuerySchema)
  .action(async ({ parsedInput: { query } }) => {
    if (query === "") return [];

    return db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(ilike(companies.name, `%${escapeLike(query)}%`))
      .orderBy(asc(companies.name))
      .limit(SEARCH_LIMIT);
  });
