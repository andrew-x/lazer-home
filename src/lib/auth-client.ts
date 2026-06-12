import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Client-side auth. Mirrors the server plugins (admin) so the client API stays
 * in sync. baseURL falls back to the current origin when the env var is unset.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [adminClient()],
});

export const { useSession, signIn, signOut, signUp } = authClient;
