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
