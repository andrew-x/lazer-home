import { pgErrorFields } from "./pg-error";

/**
 * True for a Postgres unique violation (SQLSTATE 23505) on a specific named
 * constraint, so callers only translate the violations they actually expect
 * into a `UserSafeActionError` (a bare `contacts_email_unique`, say) and let
 * anything else surface as a generic error. Shared by the CRM write actions.
 *
 * Reads the fields through `pgErrorFields`, since Drizzle wraps the driver error
 * and the SQLSTATE lives on `.cause` rather than the caught error itself.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const fields = pgErrorFields(error);
  return fields?.code === "23505" && fields.constraint_name === constraint;
}
