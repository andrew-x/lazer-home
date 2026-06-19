# 0014 — RBAC on Better Auth native access control

**Status:** accepted · 2026-06-18

## Context

Authorization was two coarse layers: a `metadata.role` route gate (`user`/`admin`)
and ad-hoc row-level ownership checks. There was no capability model and no notion
of roles beyond the `admin` flag. [ADR 0012](./0012-open-staff-edit-pending-rbac.md)
shipped the browse-staff directory with staff link/intro edits **open to any
signed-in user**, knowingly deferring the lock-down until a role model existed. We
also needed a capability (`pto.review`) to gate viewing other people's aggregated
PTO. Time to build the role model.

## Decision

Introduce RBAC on **Better Auth's native access-control system** (`createAccessControl`
+ the already-enabled `admin` plugin), with `src/lib/permissions.ts` as the single
source of truth. The model, matrix, helpers, and enforcement are documented in
[domains/permissions.md](../domains/permissions.md) — this ADR records the *why*.

Key choices:

1. **Better Auth native AC over a custom resolver.** The `admin` plugin is already
   enabled and ships `createAccessControl` / role `authorize`. Reusing it keeps
   server and client (`adminClient`) in sync, gives us the admin-plugin's
   `user`/`session` perms for free (merged via `defaultStatements` / `adminAc`), and
   avoids a hand-rolled permission engine to maintain and secure.
2. **Single role per user.** Simpler to reason about and audit; matches the org's
   actual structure. Multiple roles deferred until a concrete need appears.
3. **`user.role` stays a `text()` column, validated at the app layer** by `roleSchema`
   (Zod). Better Auth owns `auth-schema.ts` and regenerates it on `auth:generate`,
   so a `pgEnum` there would be clobbered. App-layer validation is the reliable
   place; a DB `CHECK` constraint is optional later hardening.
4. **The role→permission matrix is the contract, enforced by a test.** The `roles`
   map in `permissions.ts`, `permissions.test.ts`, and the table in the domain doc
   must change in lockstep. The test runs in `bun run check` (via `bun test`, added
   this iteration with `@types/bun`), so drift fails the pre-flight. This makes
   matrix changes deliberate rather than silent.
5. **Authorization declared in action metadata, never in the body.** The one
   `secureActionClient` enforces three optional, declarative forms — `metadata.role`
   (coarse), `metadata.permission` (static capability → `requirePermission`), and
   `metadata.authorize` (an **`ActionAuthorize`** hook reading `clientInput` for
   input-dependent / ownership checks) — all run before the body. The `authorize`
   hook is a **generic, reusable mechanism**, not staff-specific: any domain supplies
   its own. The check never lives inside the body, so an action can't forget it and
   an unauthorized call never reaches the mutation. (This replaced an earlier
   "compose a bespoke per-feature client" approach with a single generic hook on the
   shared client.) Reads (plain server-only functions, not actions) call
   `requirePermission` / `userHasPermission` inline. Helpers **fail closed** —
   unknown/null roles fall back to `DEFAULT_ROLE` (least privilege).
6. **Ownership-or-permission as one decision point.** `canEditStaff`
   (`src/actions/staff/canEditStaff.ts`) is the single place staff-edit authz is
   decided (own → always; other → `staff.edit`), closing ADR 0012's gap. It backs
   both forms: directly as the **UI affordance** (whether to show edit controls,
   called from `staff/[id]/page.tsx`), and via the `authorizeStaffEdit`
   `ActionAuthorize` hook wired with `metadata({ authorize })` on the edit actions
   (not in the bodies). `getStaffPto` self-scopes the same way for `pto.review`.
7. **Make permissions hard to break, not just correct.** A path-scoped rule
   (`.claude/rules/permissions.md`) states the inviolable "never weaken/bypass; flag
   any gap as a vulnerability" rule; `/audit-rbac` gives a read-only audit; AGENTS.md
   points at both.

## Consequences

- **ADR 0012 is resolved/closed by this work** — the `// TODO: lock down` markers
  are gone; staff edits and other-person PTO reads are now properly gated. See that
  ADR's updated status.
- Adding a capability or changing a role is a three-file change (matrix, test, doc)
  by design — friction is the point.
- Server-side authorization uses the **pure synchronous helpers**, not Better Auth's
  async `auth.api.userHasPermission`; the design spec floated the async API but the
  implementation is role-driven and sync (no per-check round-trip). The client
  `adminClient({ ac, roles })` exists to keep client `hasPermission` in sync, but
  is not the enforcement path.
- **Role assignment is deferred** — no UI; roles set via `setRole` / DB. Until then,
  everyone is `user` (no business perms) unless explicitly promoted.

## Alternatives considered

- **Custom permission resolver** — rejected: reinvents what the enabled `admin`
  plugin already provides, and a hand-rolled authz engine is exactly the thing you
  don't want to get subtly wrong.
- **Multiple roles per user** — deferred: no current need; adds matrix and
  assignment complexity.
- **`pgEnum` for `user.role`** — rejected: clobbered by `auth:generate`. App-layer
  `roleSchema` validation instead, DB `CHECK` as optional later hardening.
- **Gate everything on the existing `admin` flag** — rejected (same reasoning as
  ADR 0012): too coarse; a person couldn't edit their own profile, and it's not the
  real role model.
