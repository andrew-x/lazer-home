"use server";

import { and, asc, eq, ilike, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { secureActionClient } from "@/lib/core/action";
import { escapeLike } from "@/lib/core/like";
import { SEARCH_LIMIT, searchQuerySchema } from "@/lib/core/search";
import { contactName } from "@/lib/crm/contact-name";
import { nameWithEmployer } from "@/lib/crm/contact-relationship";
import { db } from "@/lib/db/db";
import { companies, contacts } from "@/lib/db/schema";

/**
 * Type-ahead search backing the contact pickers. Matches on first/last name or
 * email; returns up to `SEARCH_LIMIT` `{ id, name }` for a non-blank query
 * (blank → nothing). Gated on `crm.edit` — the same capability every picker is
 * behind — so it can't enumerate the contact roster past the page-level gate.
 *
 * The optional args narrow the candidate set per picker:
 *
 * - `excludeCompanyId` drops one company's employees, which the company page's
 *   relationship picker uses to offer only people who work elsewhere.
 * - `excludeId` drops a single contact: the one whose relationships are being
 *   edited, so no picker can offer a self-link.
 * - `includeInactive` brings inactive contacts back. **Off by default**, so every
 *   picker offers active people — but the `succeeds` predecessor picker turns it
 *   on, because the record it is looking for is precisely an inactive one (linking
 *   a successor is what deactivated it).
 * - `withCompany` suffixes each label with the employer. The succession picker
 *   needs it: every candidate there is *the same person's name*, so without the
 *   company the options are indistinguishable. Only ids are submitted, so the
 *   suffix never reaches storage.
 */
export const searchContacts = secureActionClient
  .metadata({
    action: "search-contacts",
    permission: { crm: ["edit"] },
  })
  .inputSchema(
    searchQuerySchema.extend({
      excludeCompanyId: z.string().min(1).nullish(),
      excludeId: z.string().min(1).nullish(),
      includeInactive: z.boolean().optional().default(false),
      withCompany: z.boolean().optional().default(false),
    }),
  )
  .action(
    async ({
      parsedInput: {
        query,
        excludeCompanyId,
        excludeId,
        includeInactive,
        withCompany,
      },
    }) => {
      if (query === "") return [];

      const like = `%${escapeLike(query)}%`;
      const rows = await db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          companyName: companies.name,
        })
        .from(contacts)
        .leftJoin(companies, eq(contacts.companyId, companies.id))
        .where(
          and(
            // A bare `ne(companyId, x)` is NULL-unknown for employer-less contacts
            // and would silently drop them, so spell out the null case.
            excludeCompanyId
              ? or(
                  isNull(contacts.companyId),
                  ne(contacts.companyId, excludeCompanyId),
                )
              : undefined,
            // Safe as a bare `ne`, unlike `companyId` above: `contacts.id` is the
            // NOT NULL primary key, so there's no NULL row to lose.
            excludeId ? ne(contacts.id, excludeId) : undefined,
            // Likewise NULL-safe — `isActive` is NOT NULL with a default.
            includeInactive ? undefined : eq(contacts.isActive, true),
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
        name: withCompany
          ? nameWithEmployer(contactName(r), r.companyName)
          : contactName(r),
      }));
    },
  );
