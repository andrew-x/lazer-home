import { UserSafeActionError } from "@/lib/core/errors";

/**
 * Guard for the empty-result-means-gone pattern: an empty `rows` means the
 * targeted row no longer exists (deleted out from under the request) — from a
 * `.returning({ id })` write or a single-row `.limit(1)` read. Throws a
 * user-safe error so the message reaches the client rather than a silent no-op.
 *
 * An assertion function, so after the call `rows` narrows to a non-empty tuple
 * and `rows[0]` is defined without a second guard. `entity` fills the message,
 * e.g. `assertRowExists(rows, "company")` → "That company no longer exists."
 * Mirrors staff's `assertStaffUpdated`, which predates this generic helper and
 * keeps its bespoke message.
 */
export function assertRowExists<T>(
  rows: readonly T[],
  entity: string,
): asserts rows is readonly [T, ...T[]] {
  if (rows.length === 0) {
    throw new UserSafeActionError(`That ${entity} no longer exists.`);
  }
}
