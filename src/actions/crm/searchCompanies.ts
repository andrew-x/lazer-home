"use server";

import { z } from "zod";
import { searchCompaniesByName } from "@/actions/shared/entitySearch";
import { secureActionClient } from "@/lib/core/action";
import { searchQuerySchema } from "@/lib/core/search";

/**
 * Type-ahead search for the contact form's company picker. Returns up to
 * `SEARCH_LIMIT` name matches for a non-blank query; a blank query returns
 * nothing (search only runs once the user types). An optional `excludeId` drops
 * one company — the relationship picker on a contact page uses it to hide that
 * contact's own employer, since a relationship is by definition non-employment.
 * Gated on `crm.edit` — the same capability the contact picker is behind — so it
 * can't be used to enumerate the company roster past the page-level gate. The
 * query body is shared with the projects company picker via
 * `searchCompaniesByName`.
 */
export const searchCompanies = secureActionClient
  .metadata({
    action: "search-companies",
    permission: { crm: ["edit"] },
  })
  .inputSchema(
    searchQuerySchema.extend({
      excludeId: z.string().min(1).nullish(),
    }),
  )
  .action(({ parsedInput: { query, excludeId } }) =>
    searchCompaniesByName(query, { excludeId: excludeId ?? undefined }),
  );
