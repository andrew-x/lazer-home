"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { assertLocalhostMiddleware, secureActionClient } from "@/lib/action";
import { db } from "@/lib/db/db";
import { user } from "@/lib/db/schema";
import { roleSchema } from "@/lib/permissions";

/**
 * Local-only bootstrap escape hatch: promote the *current* signed-in user to
 * admin. This is the ONE place a role is set by a direct column write rather than
 * the Better Auth admin API — deliberately, because `auth.api.setRole` requires
 * the caller to already BE an admin, which is exactly the chicken-and-egg this
 * solves (you can't grant yourself the first admin role through an admin-gated
 * endpoint). The value is still validated against `roleSchema`.
 *
 * Safety boundary: the `assertLocalhostMiddleware` host gate (NODE_ENV !==
 * production + loopback host) means this can NEVER run in a real deployment, and
 * `secureActionClient` requires a session — so a caller can only ever promote
 * themselves, locally. The gate is declared on the client (composed on top of
 * auth), not hand-written in the body.
 */
export const promoteSelfToAdmin = secureActionClient
  .use(assertLocalhostMiddleware)
  .metadata({ action: "promote-self-to-admin" })
  .action(async ({ ctx }) => {
    const role = roleSchema.parse("admin");
    await db.update(user).set({ role }).where(eq(user.id, ctx.user.id));
    revalidatePath("/admin/manage-users");
    return { role };
  });
