import "server-only";

import type { z } from "zod";
import { env } from "@/env";

/**
 * The Slack Web API transport: two functions, deliberately not an SDK.
 *
 * Follows the pattern ADR 0029 set with the exchange-rate call and extends it to
 * the first *authenticated* external service:
 *
 * - external I/O lives in the actions layer, not `src/lib`
 * - bare `fetch`, no HTTP client and no vendor SDK
 * - the untrusted response body is Zod-validated at the trust boundary
 * - reads cache through Next `fetch` revalidation, never `unstable_cache`
 *
 * Two Slack-specific traps this exists to close:
 *
 * 1. **`res.ok` is not success.** Slack answers HTTP 200 with
 *    `{ ok: false, error: "…" }` for most failures, including rate limiting. A
 *    caller checking only the status code would happily parse an error body.
 * 2. **A bare `fetch` has no timeout.** A hung Slack connection would hang the
 *    server action holding it, so every request carries an abort signal.
 */

/** How long any single Slack call may take before we give up on it. */
const SLACK_TIMEOUT_MS = 10_000;

const SLACK_API_BASE = "https://slack.com/api";

/**
 * Is the integration switched on? The whole feature keys off the presence of one
 * secret — the same "set it to turn the feature on" shape as the Google auth
 * pair. Callers use this to decide whether to render or skip the Slack UI, so it
 * must stay cheap and synchronous.
 */
export function isSlackConfigured(): boolean {
  return Boolean(env.SLACK_BOT_TOKEN);
}

/**
 * A failed Slack call, carrying Slack's own machine-readable `error` code so the
 * calling action can map the handful it has real copy for (`name_taken`,
 * `missing_scope`, …) and let everything else fall through to the generic
 * message. `retryAfterSeconds` is set only for rate limiting.
 */
export class SlackApiError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(`slack api error: ${code}`);
    this.name = "SlackApiError";
  }
}

/** Thrown when a Slack call is attempted with no token configured. */
export const SLACK_NOT_CONFIGURED = "not_configured";

function requireToken(): string {
  const token = env.SLACK_BOT_TOKEN;
  if (!token) throw new SlackApiError(SLACK_NOT_CONFIGURED);
  return token;
}

type CacheOptions = {
  /** Seconds to cache this response for. Omit for an uncached read. */
  revalidate?: number | false;
  tags?: string[];
};

/**
 * A cacheable Slack read (`conversations.list`, `users.lookupByEmail`).
 *
 * GET plus an explicit `next.revalidate` is load-bearing, not incidental. Next
 * normally refuses to cache a request carrying an `Authorization` header, but
 * `patch-fetch.js` only applies that rule when there is *no* explicit cache
 * config — an explicit `revalidate` wins. Both methods we cache accept GET, so
 * this stays on the supported path.
 *
 * Note the response body is persisted to the fetch cache, which is one more
 * reason callers project channel data down to `{ id, name, isPrivate }` rather
 * than storing whatever Slack returned.
 */
export async function slackGet<T extends z.ZodType>(
  method: string,
  params: Record<string, string>,
  schema: T,
  cache: CacheOptions = {},
): Promise<z.infer<T>> {
  const token = requireToken();
  const query = new URLSearchParams(params).toString();
  const url = `${SLACK_API_BASE}/${method}${query ? `?${query}` : ""}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    ...(cache.revalidate === undefined
      ? {}
      : { next: { revalidate: cache.revalidate, tags: cache.tags } }),
  });

  return parseSlackResponse(res, schema);
}

/**
 * A Slack write (`conversations.create`, `conversations.invite`,
 * `conversations.archive`). POST-only and never cached.
 */
export async function slackPost<T extends z.ZodType>(
  method: string,
  body: Record<string, unknown>,
  schema: T,
): Promise<z.infer<T>> {
  const token = requireToken();

  const res = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
  });

  return parseSlackResponse(res, schema);
}

/**
 * Turn a Slack HTTP response into either validated data or a `SlackApiError`.
 * Handles both shapes of rate limiting: a real HTTP 429 with `Retry-After`, and
 * an HTTP 200 whose body says `ratelimited`.
 */
async function parseSlackResponse<T extends z.ZodType>(
  res: Response,
  schema: T,
): Promise<z.infer<T>> {
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    throw new SlackApiError(
      "ratelimited",
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    );
  }
  if (!res.ok) throw new SlackApiError(`http_${res.status}`);

  const body: unknown = await res.json();
  // Slack's own success flag, checked before the payload is trusted.
  if (
    typeof body !== "object" ||
    body === null ||
    (body as { ok?: unknown }).ok !== true
  ) {
    const code = (body as { error?: unknown } | null)?.error;
    throw new SlackApiError(typeof code === "string" ? code : "unknown_error");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // A body Slack called `ok` but we can't read is a contract break on their
    // side or ours; either way it must not be treated as usable data.
    throw new SlackApiError("invalid_response");
  }
  return parsed.data;
}
