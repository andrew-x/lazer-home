/**
 * An error whose `message` is safe to show to end users.
 *
 * The action layer's `handleServerError` (src/lib/action.ts) lets the message of
 * a UserSafeActionError pass through to the client as `result.serverError`.
 * Any OTHER thrown error is collapsed to a generic message so internals never leak.
 *
 * Throw this for expected, user-facing failures (validation, authz, not-found).
 * Throw a plain Error (or let one bubble) for bugs the user shouldn't see.
 */
export class UserSafeActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserSafeActionError";
  }
}
