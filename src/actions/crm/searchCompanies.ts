"use server";

import { asc, ilike } from "drizzle-orm";
import { z } from "zod";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { companies } from "@/lib/db/schema";
import { escapeLike } from "@/lib/like";

/**
 * Type-ahead search for the contact form's company picker. Returns up to 10
 * name matches for a non-blank query; a blank query returns nothing (search only
 * runs once the user types). Gated on `crm.edit` — the same capability
 * the contact picker is behind — so it can't be used to enumerate the company
 * roster past the page-level gate.
 */
const searchCompaniesSchema = z.object({ query: z.string() });

export const searchCompanies = secureActionClient
  .metadata({
    action: "search-companies",
    permission: { crm: ["edit"] },
  })
  .inputSchema(searchCompaniesSchema)
  .action(async ({ parsedInput: { query } }) => {
    const trimmed = query.trim();
    if (trimmed === "") return [];

    return db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(ilike(companies.name, `%${escapeLike(trimmed)}%`))
      .orderBy(asc(companies.name))
      .limit(10);
  });
