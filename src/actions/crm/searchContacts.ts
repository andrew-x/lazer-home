"use server";

import { asc, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { contacts } from "@/lib/db/schema";
import { escapeLike } from "@/lib/like";

/**
 * Type-ahead search for the opportunity form's contact pickers. Matches on
 * first/last name or email; returns up to 10 `{ id, name }` for a non-blank
 * query (blank → nothing). Gated on `crm.edit` — the same capability the picker
 * is behind — so it can't enumerate the contact roster past the page-level gate.
 */
const searchContactsSchema = z.object({ query: z.string() });

export const searchContacts = secureActionClient
  .metadata({
    action: "search-contacts",
    permission: { crm: ["edit"] },
  })
  .inputSchema(searchContactsSchema)
  .action(async ({ parsedInput: { query } }) => {
    const trimmed = query.trim();
    if (trimmed === "") return [];

    const like = `%${escapeLike(trimmed)}%`;
    const rows = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
      })
      .from(contacts)
      .where(
        or(
          ilike(contacts.firstName, like),
          ilike(contacts.lastName, like),
          ilike(contacts.email, like),
        ),
      )
      .orderBy(asc(contacts.lastName), asc(contacts.firstName))
      .limit(10);

    return rows.map((r) => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
    }));
  });
