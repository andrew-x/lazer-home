import { pgErrorFields } from "./pg-error";

/**
 * True for a Postgres foreign-key violation (SQLSTATE 23503) — a row referencing
 * a parent that doesn't exist. Pass a `constraint` name to match only that FK
 * (mirroring `isUniqueViolation`); omit it to match any FK violation. Callers use
 * it to translate the violations they expect into a `UserSafeActionError` and let
 * anything else surface as a generic error. Shared by the CRM write actions.
 *
 * Reads the fields through `pgErrorFields`, since Drizzle wraps the driver error
 * and the SQLSTATE lives on `.cause` rather than the caught error itself.
 */
export function isForeignKeyViolation(
  error: unknown,
  constraint?: string,
): boolean {
  const fields = pgErrorFields(error);
  if (fields?.code !== "23503") return false;
  return constraint === undefined || fields.constraint_name === constraint;
}
