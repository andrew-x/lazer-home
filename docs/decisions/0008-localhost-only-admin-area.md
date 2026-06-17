# 0008 — Localhost-only admin area, gated by host (not auth), outside `(app)`

**Status:** accepted · 2026-06-15

## Context

Staff need to get into the system before anyone can use it, and the first tool for that is a CSV importer that ingests a Rippling employee export (see [domains/staff-profiles.md](../domains/staff-profiles.md), [flows.md](../flows.md)). This created a bootstrapping problem with the existing auth gate: the `(app)` route-group layout admits only users with an **active staff record + employment row**, redirecting everyone else to `/profile-setup` ([0006](./0006-google-only-auth-and-layout-gating.md)). But the import tool is precisely what *creates* those staff records — so it can't live behind that gate without a chicken-and-egg deadlock. It's also a sensitive, internal seeding/maintenance surface that has no business being reachable in a real deployment.

## Decision

A separate **admin area** at `src/app/admin/**`, with two deliberate properties:

- **Outside the `(app)` route group.** It does not inherit the auth + staff-record gate, so it can run before any staff exist.
- **The security boundary is the request host, not auth.** `src/lib/admin.ts` exposes `isLocalhost()` / `assertLocalhost()`, which compare the `host` header (port-stripped, lowercased) against a loopback allowlist (`localhost`, `127.0.0.1`, `[::1]`/`::1`). `admin/layout.tsx` calls `isLocalhost()` and `notFound()`s the whole segment for non-local requests (404, not a redirect — the area is invisible remotely). The two admin server actions use `publicActionClient` + `assertLocalhost()` — **not** `secureActionClient` — for the same bootstrapping reason. Enforced server-side only; never trusted from the client.

The area is reachable by **direct URL only** (no sidebar nav entry), since it isn't part of the authenticated shell.

## Consequences

- The importer works on a developer's machine against the configured DB with zero auth setup — the intended "seed the system" path.
- **The gate is only as strong as the `host` header in this deployment topology.** It assumes a real deployment is never served over a loopback host and that the host header reaching the server is trustworthy (no proxy rewriting it to `localhost`). For a single-tenant internal app run locally for seeding, that's acceptable; if admin ever needs to run somewhere remote, this must be revisited (add real authz, don't loosen the host check).
- Admin actions bypass the route-level authz layer entirely — every admin action **must** call `assertLocalhost()` itself. There's no middleware doing it for them.
- Splitting from `(app)` means the admin area has its own minimal chrome (`admin/layout.tsx`), separate from `AppShell`.

## Alternatives considered

- **Put it behind admin-role auth inside `(app)`** — rejected: the chicken-and-egg deadlock (no staff record → can't pass the `(app)` gate → can't run the tool that creates staff records), and it would expose the surface in production.
- **An env flag (e.g. `ADMIN_ENABLED`)** — rejected as easy to misconfigure into production; the loopback-host check is self-evident and needs no extra config.
- **A standalone CLI script instead of a route** — rejected: the review-before-commit UX (preview tables of New / Updates / Skipped) is much better in the browser, and it reuses the existing action/transform code.
