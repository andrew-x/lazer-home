/**
 * True for a Postgres unique violation (SQLSTATE 23505) on a specific named
 * constraint, so callers only translate the violations they actually expect
 * into a `UserSafeActionError` (a bare `contacts_email_unique`, say) and let
 * anything else surface as a generic error. Shared by the CRM write actions.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; constraint_name?: unknown };
  return e.code === "23505" && e.constraint_name === constraint;
}
