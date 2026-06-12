import { randomUUID } from "node:crypto";
import {
  createSafeActionClient,
  DEFAULT_SERVER_ERROR_MESSAGE,
} from "next-safe-action";
import { z } from "zod";
import { checkAuth } from "@/lib/auth";
import { UserSafeActionError } from "@/lib/errors";
import { logger } from "@/lib/logger";

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
      role: z.enum(["user", "admin"]).optional(),
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
 */
export const secureActionClient = publicActionClient.use(
  async ({ next, metadata }) => {
    const user = await checkAuth(metadata.role ?? "user");
    return next({ ctx: { user } });
  },
);
