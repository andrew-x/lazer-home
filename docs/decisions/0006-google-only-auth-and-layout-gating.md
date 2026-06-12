# 0006 — Google-only auth + route-group/server-layout gating (not middleware)

**Status:** accepted · 2026-06-12 · refines [0003](./0003-stack-selection.md)

## Context

The auth plumbing existed (better-auth + `authClient`) but no screens, and the stack ADR left both email/password and Google enabled. Building the authenticated UI forced two decisions: *which* sign-in methods to actually offer, and *where* to enforce that unauthenticated users can't reach app pages.

This is an internal tool for Lazer staff — everyone already has a company Google account, and we don't want to own a password surface (resets, hashing policy, credential-stuffing) for a closed user base.

## Decision

**Google-only sign-in.** In `src/lib/auth.ts`, `emailAndPassword` is set to `{ enabled: false }` and the only social provider is Google (configured behind `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, with `prompt: "select_account"`). The login screen offers a single "Continue with Google" button (`authClient.signIn.social({ provider: "google", callbackURL: "/" })`); sign-out is `authClient.signOut()`.

**Route protection lives in the `(app)` layout, not middleware.** `src/app/(app)/layout.tsx` is an async Server Component that does `const user = await getCurrentUser(); if (!user) redirect("/login")` before rendering `<AppShell>`. Public pages live in the separate `(auth)` route group. This continues the project's deliberate **no-middleware** posture (the same reason `env.ts` skips `import "server-only"` and auth runs through a catch-all route, not edge middleware).

## Consequences

- No password storage, reset flows, or credential UI to build or secure. Access is gated by who has a Google account we've authorized.
- One gate per protected segment: every page under `(app)/` is covered by the layout's check, with no per-page boilerplate. Adding a protected page means putting it under `(app)/`. A public page goes under `(auth)/` (or another non-`(app)` group).
- The check runs in a Server Component on the Node/Bun server (where `getCurrentUser()` reads the session via `headers()`), so it doesn't depend on an edge runtime — consistent with the plain-Postgres, server-rendered model from [0003](./0003-stack-selection.md).
- **Defense in depth still required:** layout gating protects *navigation*, not data. Mutations and sensitive reads must still authorize via the action layer (`secureActionClient` / `checkAuth`, route- + row-level — see [0004](./0004-action-layer.md)). A layout redirect is not an authz boundary for server actions.
- Re-enabling email/password later is a one-line auth-config change plus a form — the action/session machinery already supports it.

## Alternatives considered

- **Next.js middleware for route protection** — rejected to keep the no-middleware approach: gating in a Server Component layout keeps auth logic colocated with the routes it guards, runs in the same runtime as the rest of the app, and avoids an edge/runtime split. The route-group boundary makes "what's public" explicit in the file tree.
- **Keep email/password enabled too** — rejected for an internal, all-Google-account user base: more attack surface and support burden for no benefit.
- **Per-page auth checks** — rejected: duplicative and easy to forget on a new page; the layout makes the secure path the default.
</content>
