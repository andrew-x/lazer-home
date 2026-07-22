import type { SafeActionFn, ValidationErrors } from "next-safe-action";
import { z } from "zod";

/**
 * Shared primitives for the type-ahead search actions (companies, contacts,
 * staff). Each action's query body legitimately differs (different tables and
 * columns), but they all take the same single-query input, trim it, treat a
 * blank query as "no search", and cap results at the same limit — so those bits
 * live here once.
 */

/** Max rows any type-ahead search returns. */
export const SEARCH_LIMIT = 10;

/**
 * Input for a type-ahead search: a single query string, trimmed on parse. A
 * blank/whitespace query parses to "" — callers short-circuit that to an empty
 * result (search only runs once the user types).
 */
export const searchQuerySchema = z.object({
  query: z.string().transform((value) => value.trim()),
});

/**
 * The contract an entity-picker search action must satisfy — the generic shape
 * the `EntityCombobox`/`EntityMultiCombobox` accept, replacing what used to be
 * captured as `typeof searchStaff` (which leaked a concrete CRM caller into the
 * generic component). Structurally: a next-safe-action action whose input starts
 * from `searchQuerySchema` (`{ query }`) and resolves to a list of `{ id, name }`
 * options. Any action of this shape works (searchStaff, searchContacts,
 * searchCompanies, …); a caller may layer optional scope args (e.g. `companyId`)
 * on top of `query`.
 */
export type SearchAction = SafeActionFn<
  string,
  typeof searchQuerySchema,
  [],
  ValidationErrors<typeof searchQuerySchema>,
  Array<{ id: string; name: string }>
>;
