import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { ac, roles } from "@/lib/permissions";

/**
 * Client-side auth. Mirrors the server plugins (admin + RBAC ac/roles) so the
 * client API (`authClient.admin.hasPermission` / `checkRolePermission`) stays in
 * sync. baseURL falls back to the current origin when the env var is unset.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [adminClient({ ac, roles })],
});

export const { useSession, signIn, signOut, signUp } = authClient;
