# 0006 — Google-only auth + route-group/server-layout gating (not middleware)

**Status:** accepted · 2026-06-12 (staff-record gate added 2026-06-15) · refines [0003](./0003-stack-selection.md)

## Context

The auth plumbing existed (better-auth + `authClient`) but no screens, and the stack ADR left both email/password and Google enabled. Building the authenticated UI forced two decisions: *which* sign-in methods to actually offer, and *where* to enforce that unauthenticated users can't reach app pages.

This is an internal tool for Lazer staff — everyone already has a company Google account, and we don't want to own a password surface (resets, hashing policy, credential-stuffing) for a closed user base.

## Decision

**Google-only sign-in.** In `src/lib/auth/auth.ts`, `emailAndPassword` is set to `{ enabled: false }` and the only social provider is Google (configured behind `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, with `prompt: "select_account"`). The login screen offers a single "Continue with Google" button (`authClient.signIn.social({ provider: "google", callbackURL: "/" })`); sign-out is `authClient.signOut()`.

**Route protection lives in the `(app)` layout, not middleware.** `src/app/(app)/layout.tsx` is an async Server Component that does `const user = await getCurrentUser(); if (!user) redirect("/login")` before rendering `<AppShell>`. Public pages live in the separate `(auth)` route group. This continues the project's deliberate **no-middleware** posture (the same reason `env.ts` skips `import "server-only"` and auth runs through a catch-all route, not edge middleware).

**A valid Google session is necessary but not sufficient — the app also gates on a usable staff record** (added after the staff schema landed). Anyone with a company Google account can authenticate, but only people we've provisioned a staff record for should reach the app. So after the session check the `(app)` layout calls `getCurrentStaffAccess(user)` (`src/actions/staff/getCurrentStaffAccess.ts` — originally `getCurrentStaff` in `src/lib/staff.ts`, since folded into the actions layer per [ADR 0010](./0010-actions-layer-owns-db-access.md)) and admits only `ok`:

- **`ok`** — active `staff` row (`isActive = true`) with ≥1 `staff_employment` row → enter the app.
- **`not_setup`** — no active staff row matched → `redirect("/profile-setup")`.
- **`incomplete`** — active staff row but zero employment rows → `redirect("/profile-setup")`.

The status is a **discriminated union** so callers must handle each case. Because staff are synced from Rippling by email *before* anyone signs in (`staff.userId` starts null), the resolver matches by `userId` first, then falls back to the active row with a matching `email` and **auto-links** it by writing `staff.userId` — guarded on `userId IS NULL` so it fires once per person and concurrent logins are harmless. This is the *only* sanctioned email-based identity match (email is not unique; see [0007](./0007-staff-employment-effective-dating.md)). The block screen is a single `/profile-setup` page in a separate `(onboarding)` route group; it has no group layout and self-gates like `/login` (redirect unauthenticated → `/login`, bounce `ok` → `/`), showing one of two messages (`not_setup` vs `incomplete`) so a fixed-up profile is never stuck. A single page (rather than two routes + a group layout) avoids a layout that would either re-loop or duplicate the gate, and keeps the two messages co-located.

## Consequences

- No password storage, reset flows, or credential UI to build or secure. Access is gated by who has a Google account we've authorized.
- One gate per protected segment: every page under `(app)/` is covered by the layout's check, with no per-page boilerplate. Adding a protected page means putting it under `(app)/`. A public page goes under `(auth)/` (or another non-`(app)` group).
- The check runs in a Server Component on the Node/Bun server (where `getCurrentUser()` reads the session via `headers()`), so it doesn't depend on an edge runtime — consistent with the plain-Postgres, server-rendered model from [0003](./0003-stack-selection.md).
- **Defense in depth still required:** layout gating protects *navigation*, not data. Mutations and sensitive reads must still authorize via the action layer (`secureActionClient` / `checkAuth`, route- + row-level — see [0004](./0004-action-layer.md)). A layout redirect is not an authz boundary for server actions.
- Re-enabling email/password later is a one-line auth-config change plus a form — the action/session machinery already supports it.
- The staff-record gate runs **two extra queries per authenticated request** (staff lookup + employment existence) on top of the session read, and a one-time write on first login. Acceptable for an internal tool; revisit if the layout hot path needs caching.
- Provisioning is a manual, out-of-band step ("contact Andrew") — there is no self-serve onboarding. A synced staff row with no employment history is reachable but blocked (`incomplete`), which makes "synced but not finished" visible rather than silently letting someone in.

## Alternatives considered

- **Next.js middleware for route protection** — rejected to keep the no-middleware approach: gating in a Server Component layout keeps auth logic colocated with the routes it guards, runs in the same runtime as the rest of the app, and avoids an edge/runtime split. The route-group boundary makes "what's public" explicit in the file tree.
- **Keep email/password enabled too** — rejected for an internal, all-Google-account user base: more attack surface and support burden for no benefit.
- **Per-page auth checks** — rejected: duplicative and easy to forget on a new page; the layout makes the secure path the default.
