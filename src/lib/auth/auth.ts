import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { headers } from "next/headers";
import { env } from "@/env";
import { ac, isAdmin, roles } from "@/lib/auth/permissions";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import * as schema from "@/lib/db/schema";
import { DRIVE_SCOPE } from "@/lib/drive/scope";

// Destructure so the presence check below genuinely narrows both to `string`
// inside the truthy branch — no `as string` casts on `string | undefined`.
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env;

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  // Reuse the same Drizzle singleton; auth tables live in our schema/migrations.
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Google-only sign-in (see docs/decisions). Email/password is intentionally off.
  emailAndPassword: { enabled: false },
  socialProviders:
    GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            // Drive access rides on the login rather than being a second
            // connection to manage, so every Drive call in src/actions/drive/
            // acts as the signed-in person — which is what makes Google enforce
            // shared-drive membership for us and keeps Drive's audit trail
            // naming the real human. See docs/decisions/0069.
            scope: [DRIVE_SCOPE],
            // Both of these are load-bearing for Drive, not cosmetic. Google
            // issues a refresh token ONLY on an explicit consent with offline
            // access, so dropping either leaves us with a one-hour access token
            // and no way to renew it — Drive would work until first lunch.
            accessType: "offline",
            prompt: "select_account consent",
          },
        }
      : undefined,
  account: {
    // Encrypt the stored OAuth tokens. With `accessType: "offline"` above, this
    // table now holds refresh tokens granting standing full-Drive access to
    // every employee, so a leaked dump would be a company-wide compromise
    // rather than a password reset.
    //
    // Keyed on BETTER_AUTH_SECRET. The consequence to know: reading
    // `account.accessToken` with Drizzle now returns ciphertext — go through
    // `auth.api.getAccessToken`, which decrypts AND refreshes (see
    // src/actions/drive/driveToken.ts).
    encryptOAuthTokens: true,
  },
  // nextCookies() MUST be last so it can flush Set-Cookie from server actions.
  // RBAC: roles/permissions are defined in src/lib/permissions.ts (single source
  // of truth). `adminRoles` lists roles allowed to use admin-plugin endpoints.
  plugins: [
    admin({ ac, roles, adminRoles: ["admin"], defaultRole: "user" }),
    nextCookies(),
  ],
});

/** Server-side session read used everywhere. Returns the user, or null. */
export async function getCurrentUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/**
 * Route-level authorization for the action layer.
 * Throws a user-safe error if unauthenticated or under-privileged.
 * Admins satisfy any role requirement (admin override).
 */
export async function checkAuth(requiredRole: "user" | "admin" = "user") {
  const user = await getCurrentUser();
  if (!user) throw new UserSafeActionError("You must be signed in to do that.");
  if (requiredRole === "admin" && !isAdmin(user)) {
    throw new UserSafeActionError("You don't have permission to do that.");
  }
  return user;
}
