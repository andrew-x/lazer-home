import { desc } from "drizzle-orm";
import { staffRating } from "@/lib/db/schema";

/**
 * Canonical ordering for "current rating wins": highest `effectiveDate`, then
 * latest `createdAt` to break same-day ties — the same effective-dating rule as
 * employment (ADR 0007), applied to staff ratings. Spread into a query's
 * `.orderBy(...)` so the first row per staff is that person's current level.
 *
 * A pure query fragment (no `db`), server-side only — kept out of the pure
 * `@/lib/staff-rating` module so drizzle/schema never leaks into a client bundle.
 */
export const latestRatingFirst = [
  desc(staffRating.effectiveDate),
  desc(staffRating.createdAt),
] as const;
