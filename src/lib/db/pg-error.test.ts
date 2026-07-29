import { describe, expect, test } from "bun:test";
import { isForeignKeyViolation } from "./foreign-key-violation";
import { pgErrorFields } from "./pg-error";
import { isUniqueViolation } from "./unique-violation";

/**
 * These predicates decide whether a constraint violation reaches the user as a
 * useful message ("A contact with that email already exists.") or as the generic
 * fallback. Drizzle wraps driver errors in a `DrizzleQueryError` and hangs the
 * real `PostgresError` off `.cause`, so a top-level `error.code` read silently
 * matches nothing — a failure with no visible symptom beyond a worse message,
 * which is exactly the kind worth pinning.
 *
 * (ADR 0037: tests are added deliberately. This is the "beyond the type checker"
 * case — `unknown` satisfies the types either way.)
 */

/** The shape Drizzle actually throws: fields one level down, on `cause`. */
function wrapped(code: string, constraintName: string) {
  return {
    query: "insert into …",
    params: [],
    cause: { code, constraint_name: constraintName },
  };
}

describe("pgErrorFields", () => {
  test("finds the fields on a wrapped DrizzleQueryError", () => {
    expect(pgErrorFields(wrapped("23505", "contacts_email_unique"))).toEqual({
      code: "23505",
      constraint_name: "contacts_email_unique",
    });
  });

  test("still finds them on a bare driver error", () => {
    const bare = { code: "23503", constraint_name: "some_fk" };
    expect(pgErrorFields(bare)).toBe(bare);
  });

  test("returns null for non-Postgres errors", () => {
    expect(pgErrorFields(new Error("boom"))).toBeNull();
    expect(pgErrorFields(null)).toBeNull();
    expect(pgErrorFields("string")).toBeNull();
    expect(pgErrorFields({ cause: { cause: {} } })).toBeNull();
  });

  test("a self-referential cause chain terminates", () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(pgErrorFields(loop)).toBeNull();
  });
});

describe("isUniqueViolation", () => {
  test("matches the named constraint through the wrapper", () => {
    const error = wrapped("23505", "company_contact_relationships_unique");
    expect(
      isUniqueViolation(error, "company_contact_relationships_unique"),
    ).toBe(true);
  });

  test("does not match a different constraint or a different sqlstate", () => {
    expect(
      isUniqueViolation(wrapped("23505", "contacts_email_unique"), "other_uq"),
    ).toBe(false);
    expect(
      isUniqueViolation(
        wrapped("23503", "contacts_email_unique"),
        "contacts_email_unique",
      ),
    ).toBe(false);
  });
});

describe("isForeignKeyViolation", () => {
  test("matches any FK violation when no constraint is given", () => {
    expect(isForeignKeyViolation(wrapped("23503", "anything_fk"))).toBe(true);
  });

  test("matches only the named constraint when one is given", () => {
    expect(isForeignKeyViolation(wrapped("23503", "a_fk"), "a_fk")).toBe(true);
    expect(isForeignKeyViolation(wrapped("23503", "a_fk"), "b_fk")).toBe(false);
  });

  test("rejects a unique violation", () => {
    expect(isForeignKeyViolation(wrapped("23505", "a_uq"))).toBe(false);
  });
});
