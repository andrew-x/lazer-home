# 0004 — The action layer: two-client composition + UserSafeActionError

**Status:** accepted · 2026-06-12

## Context

Most data in a PSA system is sensitive (rates, salaries, reviews), and nearly every mutation needs the same cross-cutting concerns: authentication, role checks, input validation, logging, and error handling that never leaks internals to the client. Repeating these per action is error-prone — it's how an auth or validation step gets forgotten on one endpoint. next-safe-action v8 gives us middleware composition to centralize them.

## Decision

Build two action clients by composition in `src/lib/action.ts`, and make every action a declarative chain.

- **`publicActionClient`** — the base. Typed metadata (`{ action, role? }`), one middleware that logs `action_start`/`action_end` with a requestId + timing, and `handleServerError` that shapes errors safely.
- **`secureActionClient`** — `publicActionClient` + one more middleware that calls `checkAuth(metadata.role ?? "user")` and injects `ctx.user`, so every secure action gets the user without re-fetching the session. Used for almost everything; `publicActionClient` only for genuinely public actions.
- Actions are `client.metadata({ action }).inputSchema(zod).action(fn)` — auth, validation, logging, and safe errors all come from the client.

**`UserSafeActionError`** (`src/lib/errors.ts`) is the deliberate seam: its message is the *only* thing `handleServerError` passes through to `result.serverError`. Every other throw collapses to a generic message. So "expected, user-facing failure" vs. "bug the user must not see" is expressed by *which error type you throw*, not by remembering to sanitize at each call site.

Authz is intentionally two-layered (route-level via `metadata.role`; row-level via an ownership check in the body) because the route check can't know about per-row ownership — see [architecture.md](../architecture.md) and `.claude/rules/server-actions.md`.

## Consequences

- Adding a mutation is a short, safe declarative chain; the easy path is also the secure one.
- Internal errors never leak by default — you must *opt in* to a user-visible message via `UserSafeActionError`.
- `clientInput` is logged in `action_start`; the code flags that sensitive fields must be redacted before production logging.
- Validation uses `inputSchema` (v8 name), not v7's `schema` — a known migration gotcha.

## Alternatives considered

- **Per-action ad-hoc auth/validation** — rejected: duplicative and the source of "forgot the check on one endpoint" bugs.
- **Returning raw errors / a single client** — rejected: risks leaking internals and loses the typed metadata that gates the secure client.
