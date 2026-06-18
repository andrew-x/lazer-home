import { randomUUID } from "node:crypto";
import {
  createSafeActionClient,
  DEFAULT_SERVER_ERROR_MESSAGE,
} from "next-safe-action";
import { z } from "zod";
import { checkAuth } from "@/lib/auth";
import { UserSafeActionError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { type PermissionCheck, requirePermission } from "@/lib/permissions";

/**
 * Optional per-action authorization hook for input-dependent checks (ownership,
 * "own-vs-other", cross-field rules) that a static `permission` can't express.
 * Runs after auth and the static `permission` check, BEFORE the action body.
 * Throw `UserSafeActionError` to deny. `clientInput` is the raw, pre-validation
 * input — narrow it yourself. Generic: any action/domain supplies its own.
 */
export type ActionAuthorize = (args: {
  user: Awaited<ReturnType<typeof checkAuth>>;
  clientInput: unknown;
}) => void | Promise<void>;

/**
 * The action layer. Two clients built by composition:
 *
 *   publicActionClient  — logging + safe error shaping + typed metadata
 *   secureActionClient  — publicActionClient + auth middleware (injects ctx.user)
 *
 * An action file is then a declarative chain:
 *   secureActionClient.metadata({ action }).inputSchema(zod).action(fn)
 * with auth, validation, logging and safe errors all handled by the client.
 */
export const publicActionClient = createSafeActionClient({
  // Every action declares typed metadata. `role` gates the secure client below.
  defineMetadataSchema() {
    return z.object({
      action: z.string(),
      // Coarse role gate (admins override). Prefer `permission` for capabilities.
      role: z.enum(["user", "admin"]).optional(),
      // Static capability gate, enforced by secureActionClient below.
      permission: z.custom<PermissionCheck>().optional(),
      // Input-dependent authorization hook (ownership etc.), also enforced below.
      authorize: z.custom<ActionAuthorize>().optional(),
    });
  },
  // The returned STRING becomes `result.serverError` on the client.
  // Only UserSafeActionError messages pass through; everything else is generic
  // so internal errors never leak.
  handleServerError(error, { metadata }) {
    logger.error("action_error", {
      action: metadata?.action,
      message: error.message,
    });
    if (error instanceof UserSafeActionError) return error.message;
    return DEFAULT_SERVER_ERROR_MESSAGE;
  },
}).use(async ({ next, metadata, clientInput }) => {
  // Per-call logging with a requestId and timing.
  // NOTE: clientInput may contain sensitive fields — redact before logging in prod.
  const requestId = randomUUID();
  const start = performance.now();
  logger.info("action_start", {
    requestId,
    action: metadata.action,
    clientInput,
  });
  const result = await next();
  logger.info("action_end", {
    requestId,
    action: metadata.action,
    durationMs: Math.round(performance.now() - start),
    success: result.success,
  });
  return result;
});

/**
 * Authenticated client: layers `checkAuth(metadata.role)` and injects the user
 * into ctx, so every secure action gets `ctx.user` for free without re-fetching
 * the session.
 *
 * Authorization is declared on the client, not hand-written in bodies — and all
 * three forms are enforced here, before the body runs:
 *   - Coarse role      → `metadata({ role: "admin" })`
 *   - Static capability → `metadata({ permission: { staff: ["edit"] } })`
 *   - Input-dependent   → `metadata({ authorize })` — a generic hook reading
 *     `clientInput` for ownership / cross-field rules (see `ActionAuthorize`).
 */
export const secureActionClient = publicActionClient.use(
  async ({ next, metadata, clientInput }) => {
    const user = await checkAuth(metadata.role ?? "user");
    if (metadata.permission) requirePermission(user, metadata.permission);
    if (metadata.authorize) await metadata.authorize({ user, clientInput });
    return next({ ctx: { user } });
  },
);
