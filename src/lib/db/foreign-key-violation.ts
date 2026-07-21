/**
 * True for a Postgres foreign-key violation (SQLSTATE 23503) — a row referencing
 * a parent that doesn't exist. Pass a `constraint` name to match only that FK
 * (mirroring `isUniqueViolation`); omit it to match any FK violation. Callers use
 * it to translate the violations they expect into a `UserSafeActionError` and let
 * anything else surface as a generic error. Shared by the CRM write actions.
 */
export function isForeignKeyViolation(
  error: unknown,
  constraint?: string,
): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; constraint_name?: unknown };
  if (e.code !== "23503") return false;
  return constraint === undefined || e.constraint_name === constraint;
}
