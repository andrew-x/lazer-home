"use server";

import { and, asc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { contacts } from "@/lib/db/schema";
import { escapeLike } from "@/lib/like";
import { SEARCH_LIMIT, searchQuerySchema } from "@/lib/search";

/**
 * Type-ahead search backing the contact pickers. Matches on first/last name or
 * email; returns up to `SEARCH_LIMIT` `{ id, name }` for a non-blank query
 * (blank → nothing). An optional `companyId` scopes results to one company — the
 * manager picker uses it so a contact's manager can only be a colleague. Gated on
 * `crm.edit` — the same capability the picker is behind — so it can't enumerate
 * the contact roster past the page-level gate.
 */
export const searchContacts = secureActionClient
  .metadata({
    action: "search-contacts",
    permission: { crm: ["edit"] },
  })
  .inputSchema(
    searchQuerySchema.extend({
      companyId: z.string().min(1).nullish(),
    }),
  )
  .action(async ({ parsedInput: { query, companyId } }) => {
    if (query === "") return [];

    const like = `%${escapeLike(query)}%`;
    const rows = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
      })
      .from(contacts)
      .where(
        and(
          companyId ? eq(contacts.companyId, companyId) : undefined,
          or(
            ilike(contacts.firstName, like),
            ilike(contacts.lastName, like),
            ilike(contacts.email, like),
          ),
        ),
      )
      .orderBy(asc(contacts.lastName), asc(contacts.firstName))
      .limit(SEARCH_LIMIT);

    return rows.map((r) => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
    }));
  });
