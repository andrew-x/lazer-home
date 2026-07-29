import "server-only";

import { UserSafeActionError } from "@/lib/core/errors";
import { isUniqueViolation } from "@/lib/db/unique-violation";

/**
 * The manager rule moved out of this file with `contacts.managerId`: management is
 * now a `reports_to` row in `contact_relationships`, so the same-company check (and
 * the new no-self and no-cycle checks) live in `contactRelationshipChecks.ts`
 * alongside the other relationship kinds.
 */

/**
 * Map a `contacts_email_unique` violation to a user-safe message; rethrow
 * anything else. Shared by create/update contact. Returns `never` — always
 * throws — so callers can use it as the whole body of a catch block.
 */
export function mapContactEmailConflict(error: unknown): never {
  if (isUniqueViolation(error, "contacts_email_unique")) {
    throw new UserSafeActionError("A contact with that email already exists.");
  }
  throw error;
}
