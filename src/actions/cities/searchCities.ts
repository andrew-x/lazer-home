"use server";

import { searchCities as searchCitiesData } from "@/lib/cities/cities";
import { secureActionClient } from "@/lib/core/action";
import { searchQuerySchema } from "@/lib/core/search";

/**
 * Type-ahead search for the location comboboxes on the contact and company pages.
 * Returns up to `SEARCH_LIMIT` city matches for a non-blank query; a blank query
 * returns nothing (search only runs once the user types). The query body lives in
 * `@/lib/cities/cities` (a static in-memory list, not the DB).
 *
 * RBAC: auth-gated by `secureActionClient` (must be signed in) but intentionally
 * carries NO capability gate — it exposes only a static, public world-cities list,
 * never any user or tenant data, so there is nothing to scope per role.
 */
export const searchCities = secureActionClient
  .metadata({ action: "search-cities" })
  .inputSchema(searchQuerySchema)
  // The query body is synchronous (an in-memory list), but next-safe-action
  // expects an async handler, so `Promise.resolve` it.
  .action(({ parsedInput: { query } }) =>
    Promise.resolve(searchCitiesData(query)),
  );
