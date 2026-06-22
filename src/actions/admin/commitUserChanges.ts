"use server";

import { inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { secureActionClient } from "@/lib/action";
import { assertLocalhost } from "@/lib/admin";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/db";
import { user } from "@/lib/db/schema";
import { UserSafeActionError } from "@/lib/errors";
import { updateUsersSchema } from "./updateUsers.schema";

export type CommitUserChangesResult = { usersAffected: number };

/** Pull the most useful message out of a Better Auth APIError (or any throw). */
function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const body = (error as { body?: { message?: unknown } }).body;
    if (body && typeof body.message === "string") return body.message;
    if (error instanceof Error && error.message) return error.message;
  }
  return "Unknown error";
}

/**
 * Apply inline user edits (RBAC role + ban status) in one pass.
 *
 * Mutations go through the Better Auth admin API — `setRole` / `banUser` /
 * `unbanUser` — rather than direct column writes, so a ban also revokes the
 * user's sessions. Those endpoints require the caller to be an admin, which the
 * `role: "admin"` gate guarantees (and which is also what gives us a session to
 * forward). The whole `/admin` segment is local-only, so `assertLocalhost()` is
 * re-asserted here as the action-level boundary.
 *
 * The client payload is never trusted: current role/banned are re-read and
 * no-op changes are dropped before any endpoint is called.
 */
export const commitUserChanges = secureActionClient
  .metadata({ action: "commit-user-changes", role: "admin" })
  .inputSchema(updateUsersSchema)
  .action(
    async ({ parsedInput: { changes } }): Promise<CommitUserChangesResult> => {
      await assertLocalhost();

      const userIds = changes.map((c) => c.userId);
      const currentRows = await db
        .select({
          id: user.id,
          name: user.name,
          role: user.role,
          banned: user.banned,
        })
        .from(user)
        .where(inArray(user.id, userIds));

      const currentById = new Map(currentRows.map((r) => [r.id, r]));
      const labelFor = (id: string) => currentById.get(id)?.name ?? id;

      const requestHeaders = await headers();
      let usersAffected = 0;

      for (const change of changes) {
        const current = currentById.get(change.userId);
        if (!current) {
          throw new UserSafeActionError(
            `No user found for ${labelFor(change.userId)}.`,
          );
        }

        const roleChanged = (current.role ?? null) !== change.role;
        const bannedChanged = (current.banned ?? false) !== change.banned;
        if (!roleChanged && !bannedChanged) continue;

        try {
          if (roleChanged && change.role != null) {
            await auth.api.setRole({
              body: { userId: change.userId, role: change.role },
              headers: requestHeaders,
            });
          }
          if (bannedChanged) {
            if (change.banned) {
              await auth.api.banUser({
                body: { userId: change.userId },
                headers: requestHeaders,
              });
            } else {
              await auth.api.unbanUser({
                body: { userId: change.userId },
                headers: requestHeaders,
              });
            }
          }
        } catch (error) {
          throw new UserSafeActionError(
            `Could not update ${labelFor(change.userId)}: ${errorMessage(error)}`,
          );
        }

        usersAffected += 1;
      }

      revalidatePath("/admin/manage-users");
      return { usersAffected };
    },
  );
