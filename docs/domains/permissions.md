# Permissions (RBAC)

**Status: built.** Role-based access control over the PSA platform, on Better Auth's
native access-control system (the already-enabled `admin` plugin). This is the
authorization model the other domains gate against; it closes the [ADR 0012](../decisions/0012-open-staff-edit-pending-rbac.md)
open-staff-edit gap and adds capability-based gating to the action layer.

> **Inviolable rule:** permissioning must never be weakened, bypassed, or worked
> around. If you find a gap, escalation path, or leak, **STOP and flag it as a
> vulnerability** before doing anything else. See `.claude/rules/permissions.md`
> (auto-loads when you touch auth / action / actions files) and run `/audit-rbac`.

## Single source of truth — `src/lib/permissions.ts`

Everything about access control lives in **one file**: the statement (resources +
actions), the access controller, the roles, the role→permission matrix, the Zod
role schema, and the helpers. Auth wiring (`auth.ts` / `auth-client.ts`), the
action layer, the staff-edit guard, and the PTO read all enforce *through* it.
Don't re-implement role checks inline (`user.role === "manager"`) — call the
helpers.

## Permission model

Permissions are `(resource, action)` pairs. The `statement` merges Better Auth's
`defaultStatements` (the admin plugin's `user` / `session` management perms, kept
so the admin role retains its built-in capabilities) with two business resources:

- **`staff.edit`** — edit *another* staff member's profile. (Editing your *own*
  linked profile never needs it — see ownership rule below.)
- **`pto.review`** — view the aggregated PTO summary of *other* staff. (Your own
  PTO is always visible.)

Both semantics are about acting on **other** people; the owner path is always
allowed without a permission.

## Roles → permissions (the canonical matrix — THIS IS THE CONTRACT)

Single role per user. Roles are stored in `user.role` (text). This table is the
contract; it is asserted by `src/lib/permissions.test.ts` (runs in `bun run check`
via `bun test`) and audited by `/audit-rbac`. **Changing it requires changing the
`roles` map in `permissions.ts`, the test, and this table in lockstep** — that
friction is deliberate.

| Role               | `staff.edit` | `pto.review` | Notes                                |
| ------------------ | :----------: | :----------: | ------------------------------------ |
| `user`             |      –       |      –       | default role for new users           |
| `delivery-manager` |      –       |      –       | no business perms yet                |
| `finance`          |      –       |      –       | no business perms yet                |
| `sales`            |      –       |      –       | no business perms yet                |
| `manager`          |      ✓       |      ✓       | all defined business perms           |
| `admin`            |      ✓       |      ✓       | + Better Auth admin-plugin user/session perms (`...adminAc.statements`) |

`DEFAULT_ROLE = "user"`, mirrored by `admin({ defaultRole: "user" })` in `auth.ts`.
`adminRoles: ["admin"]` lists which roles may call the admin-plugin endpoints.

## Helpers — how to gate

All exported from `src/lib/permissions.ts`. They are **pure and synchronous**,
driven entirely by `user.role` (no DB / network round-trip), so they're cheap to
call in action bodies and SSR reads alike.

- **`userHasPermission(user, perms): boolean`** — does this user's role grant the
  requested permission(s)? Use for conditional logic (e.g. return `null` instead of
  throwing). **Fails closed:** unknown / null roles fall back to `DEFAULT_ROLE`
  (least privilege), so a misconfigured role can never accidentally grant access.
- **`requirePermission(user, perms): void`** — asserts a permission, throwing
  `UserSafeActionError("You don't have permission to do that.")` when denied. Used
  by `secureActionClient` (for `metadata.permission`), by `metadata.authorize` hooks
  (e.g. `authorizeStaffEdit`), and in reads where denial should be an error — i.e.
  wherever authz is enforced, just not inside action bodies.
- **`isAppRole(role): role is AppRole`** — type guard narrowing an arbitrary role
  string to a known role.
- **`roleSchema`** (Zod enum of `ROLE_SLUGS`) — validate any role value before it's
  written to `user.role`. Never write an arbitrary string into that column.

`perms` is a `PermissionCheck` — a subset of the statement, e.g.
`{ staff: ["edit"] }` or `{ pto: ["review"] }`.

## Enforcement — three metadata forms on the one client (never in the body)

This builds on the [architecture authz model](../architecture.md#authorization--rbac-declared-in-action-metadata).
Authorization is **declared in action metadata**, not hand-written in action
bodies — so an unauthorized call never reaches the mutation, and an edit action
can't forget the check. There is **one** `secureActionClient`; its middleware runs
all three forms, in order, **before the body**: `checkAuth(role)` →
`requirePermission(permission)` if set → `await authorize({ user, clientInput })` if
set. The metadata schema in `src/lib/action.ts` carries `role`, `permission`, and
`authorize` (all optional).

1. **Coarse role.** `metadata.role` → `checkAuth` (admin-override). The blunt gate.
2. **Static capability.** `metadata.permission?: PermissionCheck` →
   `requirePermission(ctx.user, …)`. Use for capabilities that don't depend on the
   input.
   ```ts
   secureActionClient
     .metadata({ action: "review-pto", permission: { pto: ["review"] } })
     .inputSchema(...)
     .action(...)
   ```
3. **Input-dependent / ownership.** Ownership (own vs. other) can't be expressed as
   a static permission — it depends on the target id in the input. So pass an
   **`ActionAuthorize`** hook as `metadata.authorize`: a function
   `({ user, clientInput }) => void | Promise<void>` that reads the raw
   pre-validation `clientInput` and throws `UserSafeActionError` to deny. The hook is
   **generic and reusable** — it is *not* staff-specific; any action/domain supplies
   its own. `secureActionClient` awaits it before the body.
   ```ts
   secureActionClient
     .metadata({ action: "update-staff-links", authorize: authorizeStaffEdit })
     .inputSchema(updateStaffLinksSchema) // includes staffId
     .action(async ({ parsedInput }) => { /* authz already ran */ })
   ```
   **Mandatory** wherever an action takes a target id it could mutate or read across
   users — a route-level gate alone is not enough.

### Where it's applied today

- **`src/actions/staff/canEditStaff.ts`** — the staff-edit decision point, closing
  ADR 0012. Exports two things:
  - **`canEditStaff(user, targetStaffId): Promise<boolean>`** — the decision: a user
    may **always** edit their **own** linked staff record; editing anyone else's
    requires `staff.edit`. (Short-circuits on the permission before touching the DB;
    otherwise resolves the caller's own `staff` row by `userId` and compares.) Used
    by `staff/[id]/page.tsx` purely as a **UI affordance** — whether to render edit
    controls.
  - **`authorizeStaffEdit: ActionAuthorize`** — the gate: reads `clientInput.staffId`
    and throws unless `canEditStaff` passes (a missing/non-string `staffId` denies by
    default). `updateStaffLinks` / `updateStaffClientIntro` declare
    `metadata({ authorize: authorizeStaffEdit })` and **carry no authz call in their
    bodies** (the old `// TODO: lock down` markers are gone). The hook is the real
    boundary; the UI check is never trusted alone. **Contract:** any action using it
    must take a `staffId: string` in its input.
- **`src/actions/staff/getStaffPto.ts`** — self-scoping read. Own PTO always
  visible; viewing another person's aggregated PTO requires `pto.review`, else it
  returns `null` and `ProfileView` hides the section (graceful, not an error).
  (Reads are plain server-only functions, not actions, so they call the helpers
  inline rather than via a composed client.)

## Wiring

- `src/lib/auth.ts`: `admin({ ac, roles, adminRoles: ["admin"], defaultRole: "user" })`.
- `src/lib/auth-client.ts`: `adminClient({ ac, roles })` — so the client API
  (`authClient.admin.hasPermission` / `checkRolePermission`) stays in sync with the
  server. Note: server-side gating uses the pure helpers above, not the client API.
- **`user.role` stays a `text()` column.** Better Auth owns `auth-schema.ts`
  (regenerated by `bun run auth:generate`); a `pgEnum` there would be clobbered on
  the next generate. Validity is enforced at the app layer by `roleSchema`. (Optional
  later hardening: a DB `CHECK` constraint in a hand-written migration.)

## Assigning roles (deferred)

There is **no role-assignment UI** in this iteration. Roles are set via Better
Auth's `setRole` API (e.g. `authClient.admin.setRole` / `auth.api.setRole`) or
directly in the DB. New users get `DEFAULT_ROLE` (`user`). A role value must
validate against `roleSchema`.

## Governance & guardrails

- **`.claude/rules/permissions.md`** — the inviolable rule + non-negotiables
  (every mutating/sensitive action declares a gate or a justified public marker;
  row-level checks mandatory on target ids; all DB access through the actions layer;
  default to deny; keep matrix/test/this-doc in lockstep). Path-scoped to
  auth / action / actions files.
- **`/audit-rbac`** (`.claude/commands/audit-rbac.md`) — a **read-only** audit of
  the whole RBAC system (code matrix vs. this table, ungated actions, stray `db`
  writes, missing row-level checks, auth wiring in sync). Reports and flags; never
  auto-fixes. Run it before claiming permissions work is done.
- **`src/lib/permissions.test.ts`** — asserts the canonical matrix; fails `bun run
  check` if any role's permission set drifts.
- **AGENTS.md** carries a "Permissions (RBAC) — never break them" pointer.

## Out of scope (deferred)

- Role-assignment UI · multiple roles per user · DB-level role enum / CHECK
  constraint · the aggregated-PTO-summary UI (only the permission + read guard are
  built). See [ADR 0014](../decisions/0014-rbac-better-auth-access-control.md).
