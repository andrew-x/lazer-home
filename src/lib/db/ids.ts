import { createId } from "@paralleldrive/cuid2";

/**
 * App-generated primary keys: a human-readable prefix + a CUID2.
 *   generateId("staff") -> "staff-tz4a8f9q..."
 *
 * IDs are minted in the app *before* insert (not DB sequences), so we always
 * know an entity's id up front and prefixes make ids self-describing in logs/URLs.
 */
export function generateId(prefix: string): string {
  return `${prefix}-${createId()}`;
}
