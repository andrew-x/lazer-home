/**
 * Postgres error fields, dug out from however Drizzle wrapped them.
 *
 * Drizzle wraps driver failures in a `DrizzleQueryError` and hangs the real
 * `PostgresError` off `.cause`, so the SQLSTATE and constraint name are NOT on the
 * error the actions layer catches. Reading `error.code` directly therefore always
 * misses — walk the cause chain instead. Shared by `isUniqueViolation` and
 * `isForeignKeyViolation` so the unwrapping lives in exactly one place.
 */
type PgErrorFields = { code?: unknown; constraint_name?: unknown };

/**
 * The first error in the `cause` chain (starting with `error` itself) that carries
 * a SQLSTATE `code`, or null when there is none. Depth-capped so a self-
 * referential cause chain can't spin.
 */
export function pgErrorFields(error: unknown): PgErrorFields | null {
  let current = error;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) return null;
    const candidate = current as PgErrorFields & { cause?: unknown };
    if (typeof candidate.code === "string") return candidate;
    current = candidate.cause;
  }
  return null;
}
