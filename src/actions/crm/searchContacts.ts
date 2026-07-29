"use server";

import { and, asc, eq, ilike, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { secureActionClient } from "@/lib/core/action";
import { escapeLike } from "@/lib/core/like";
import { SEARCH_LIMIT, searchQuerySchema } from "@/lib/core/search";
import { contactName } from "@/lib/crm/contact-name";
import { db } from "@/lib/db/db";
import { contacts } from "@/lib/db/schema";

/**
 * Type-ahead search backing the contact pickers. Matches on first/last name or
 * email; returns up to `SEARCH_LIMIT` `{ id, name }` for a non-blank query
 * (blank → nothing). An optional `companyId` scopes results to one company — the
 * manager picker uses it so a contact's manager can only be a colleague — and its
 * mirror `excludeCompanyId` drops one company's employees, which the relationship
 * picker on a company page uses to offer only people who work elsewhere. Gated on
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
      excludeCompanyId: z.string().min(1).nullish(),
    }),
  )
  .action(async ({ parsedInput: { query, companyId, excludeCompanyId } }) => {
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
          // A bare `ne(companyId, x)` is NULL-unknown for employer-less contacts
          // and would silently drop them, so spell out the null case.
          excludeCompanyId
            ? or(
                isNull(contacts.companyId),
                ne(contacts.companyId, excludeCompanyId),
              )
            : undefined,
          or(
            ilike(contacts.firstName, like),
            ilike(contacts.lastName, like),
            ilike(contacts.email, like),
          ),
        ),
      )
      .orderBy(asc(contacts.lastName), asc(contacts.firstName))
      .limit(SEARCH_LIMIT);

    return rows.map((r) => ({ id: r.id, name: contactName(r) }));
  });
