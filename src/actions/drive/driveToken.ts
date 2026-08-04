import "server-only";

import { auth } from "@/lib/auth/auth";
import { UserSafeActionError } from "@/lib/core/errors";
import { logger } from "@/lib/core/logger";
import { DRIVE_SCOPE } from "@/lib/drive/scope";

/**
 * The signed-in user's Google Drive access token.
 *
 * Drive access rides on the Google login rather than being a separate
 * connection (docs/decisions/0069), so there is no "Drive account" to look up —
 * the token is the one Better Auth already stores for the `google` provider.
 *
 * Everything goes through `auth.api.getAccessToken` rather than reading
 * `account.accessToken` with Drizzle, for two reasons: it refreshes an expired
 * token, and with `account.encryptOAuthTokens` on (see src/lib/auth/auth.ts) a
 * direct read returns ciphertext.
 *
 * Three traps this module exists to close:
 *
 * 1. **A missing refresh token fails silently.** Better Auth only refreshes when
 *    `account.refreshToken` is present; with no refresh token it returns the
 *    STALE access token and no error. Left alone that surfaces as an opaque 401
 *    from Drive several calls later, so expiry is checked here instead.
 * 2. **An old grant has no Drive scope.** Anyone who signed in before the scope
 *    was added has a perfectly valid token that cannot touch Drive. That is the
 *    same *user-visible* state as an expired one — reconnect — so both collapse
 *    to one outcome rather than two the UI would have to tell apart.
 * 3. **Better Auth stores `scope` comma-joined**, not space-joined as OAuth
 *    itself does. `scopes` off this endpoint is already split; don't re-split it
 *    on spaces or every check silently fails.
 */

/**
 * How much clock skew to treat as already-expired. Better Auth refreshes at 5s
 * from expiry; we look slightly further ahead so a token it declined to refresh
 * can't be handed to a Drive call that then takes longer than it has left.
 */
const EXPIRY_SKEW_MS = 30_000;

/**
 * The current user's Drive token, refreshed if stale — or `null` when Drive
 * isn't usable for them and they need to reconnect.
 *
 * Returns null rather than throwing because both callers care about the
 * distinction: a read renders a "reconnect" panel, a write throws. Never logs
 * the token itself.
 */
export async function getDriveAccessToken(
  userId: string,
): Promise<string | null> {
  let result: Awaited<ReturnType<typeof auth.api.getAccessToken>>;
  try {
    // No `headers` on purpose: without them Better Auth skips its session
    // lookup and uses this `userId`, which is the one the action layer already
    // authenticated. Passing headers would make the session win instead, which
    // is the same user here but a needless second read.
    result = await auth.api.getAccessToken({
      body: { providerId: "google", userId },
    });
  } catch (error) {
    // ACCOUNT_NOT_FOUND, TOKEN_REFRESH_NOT_SUPPORTED, FAILED_TO_GET_ACCESS_TOKEN
    // — all mean the same thing to the person looking at the screen.
    logger.warn("drive_token_unavailable", {
      userId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }

  if (!result.accessToken) return null;

  // Trap 2: a valid token that was never granted Drive.
  if (!result.scopes.includes(DRIVE_SCOPE)) {
    logger.info("drive_scope_not_granted", { userId });
    return null;
  }

  // Trap 1: Better Auth hands back an expired token when it has no refresh
  // token to use, so a token that is still expired here means exactly that.
  const expiresAt = result.accessTokenExpiresAt;
  if (expiresAt && expiresAt.getTime() - Date.now() < EXPIRY_SKEW_MS) {
    logger.warn("drive_token_expired_unrefreshed", { userId });
    return null;
  }

  return result.accessToken;
}

/**
 * Same, but for a write, where there is nothing to render instead. The message
 * is the one the reconnect affordance is captioned with, so the two read as the
 * same instruction.
 */
export async function requireDriveAccessToken(userId: string): Promise<string> {
  const token = await getDriveAccessToken(userId);
  if (!token) {
    throw new UserSafeActionError(
      "Reconnect your Google account to use Drive.",
    );
  }
  return token;
}
