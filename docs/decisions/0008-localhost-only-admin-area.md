# 0008 — Localhost-only admin area, gated by env + host (not auth), outside `(app)`

**Status:** accepted · 2026-06-15

## Context

Staff need to get into the system before anyone can use it, and the first tool for that is a CSV importer that ingests a Rippling employee export (see [domains/staff-profiles.md](../domains/staff-profiles.md), [flows.md](../flows.md)). This created a bootstrapping problem with the existing auth gate: the `(app)` route-group layout admits only users with an **active staff record + employment row**, redirecting everyone else to `/profile-setup` ([0006](./0006-google-only-auth-and-layout-gating.md)). But the import tool is precisely what *creates* those staff records — so it can't live behind that gate without a chicken-and-egg deadlock. It's also a sensitive, internal seeding/maintenance surface that has no business being reachable in a real deployment.

## Decision

A separate **admin area** at `src/app/admin/**`, with two deliberate properties:

- **Outside the `(app)` route group.** It does not inherit the auth + staff-record gate, so it can run before any staff exist.
- **The security boundary is a two-part local-only gate, not auth.** `src/lib/auth/admin.ts` exposes `isLocalhost()` / `assertLocalhost()` with two layers:
  - **Primary, unspoofable lock — `NODE_ENV === "production"` refuses outright** (`src/lib/auth/admin.ts:21`), before the host is ever consulted. A real deployment can never reach admin regardless of headers.
  - **Defense-in-depth — loopback host check.** In non-production, the request must also arrive over a loopback host: the `host` header (port-stripped, lowercased) is checked against a loopback allowlist (`localhost`, `127.0.0.1`, `[::1]`/`::1`), catching e.g. a dev server bound to a LAN address.

  `admin/layout.tsx` calls `isLocalhost()` and `notFound()`s the whole segment for non-local requests (404, not a redirect — the area is invisible remotely). The two admin server actions use `publicActionClient` + `assertLocalhost()` — **not** `secureActionClient` — for the same bootstrapping reason. Enforced server-side only; never trusted from the client.

The area is reachable by **direct URL only** (no sidebar nav entry), since it isn't part of the authenticated shell.

## Consequences

- The importer works on a developer's machine against the configured DB with zero auth setup — the intended "seed the system" path.
- **The `NODE_ENV` production gate closes the host-header-spoofing risk this ADR originally carried.** Because a production build refuses admin *before* the host is consulted, a proxy or client rewriting the `host` to `localhost` can't reach admin in a real deployment — the earlier "only as strong as the host header" concern no longer applies. The loopback check runs only in non-production, where it's belt-and-suspenders. If admin ever needs to run somewhere genuinely remote (a non-production deployment), this must still be revisited — add real authz, don't loosen the gates.
- Admin actions bypass the route-level authz layer entirely — every admin action **must** call `assertLocalhost()` itself. There's no middleware doing it for them.
- **Update (manage-users):** `assertLocalhost()` remains the universal boundary, but the "`publicActionClient`, never `secureActionClient`" claim above is now only true for the seeding tools (importers + bulk-editor). `commitUserChanges` *adds* `secureActionClient` + `role: "admin"` on top of `assertLocalhost()` because it mutates through the Better Auth admin API, which requires the caller to be an admin (and lets a ban revoke sessions). So that one tool isn't bootstrapping-free — it needs a pre-existing admin. See [permissions.md](../domains/permissions.md).
- Splitting from `(app)` means the admin area has its own minimal chrome (`admin/layout.tsx`), separate from `AppShell`.

## Alternatives considered

- **Put it behind admin-role auth inside `(app)`** — rejected: the chicken-and-egg deadlock (no staff record → can't pass the `(app)` gate → can't run the tool that creates staff records), and it would expose the surface in production.
- **An env flag (e.g. `ADMIN_ENABLED`)** — rejected as easy to misconfigure into production; the loopback-host check is self-evident and needs no extra config.
- **A standalone CLI script instead of a route** — rejected: the review-before-commit UX (preview tables of New / Updates / Skipped) is much better in the browser, and it reuses the existing action/transform code.
