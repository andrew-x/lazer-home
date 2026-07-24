# Permissions (RBAC)

**Status: built.** Role-based access control over the PSA platform, on Better Auth's
native access-control system (the already-enabled `admin` plugin). This is the
authorization model the other domains gate against; it closes the earlier
open-staff-edit gap (see [ADR 0014](../decisions/0014-rbac-better-auth-access-control.md))
and adds capability-based gating to the action layer.

> **Inviolable rule:** permissioning must never be weakened, bypassed, or worked
> around. If you find a gap, escalation path, or leak, **STOP and flag it as a
> vulnerability** before doing anything else. See `.claude/rules/permissions.md`
> (auto-loads when you touch auth / action / actions files) and run `/audit-rbac`.

## Single source of truth — `src/lib/auth/permissions.ts`

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
  linked profile never needs it — see ownership rule below.) **One exception has no
  owner path:** the allocations planner's `allocationNotes` are cross-person staffing
  metadata gated on the **static `staff.edit` capability** for both read and write
  (managers/admins only — a person cannot edit their own), *not* the owner-or-`staff.edit`
  hook the profile fields use. Same capability, no new matrix row — see
  [ADR 0041](../decisions/0041-allocation-notes-on-staff.md) and
  [allocations.md](./allocations.md).
- **`staff.viewCompensation`** — view *another* staff member's compensation (on
  their profile and in the history feed). (Your own compensation is always visible.)
- **`pto.review`** — view the aggregated PTO summary of *other* staff. (Your own
  PTO is always visible.)

These semantics are about acting on / viewing **other** people; the owner path is
always allowed without a permission.

Two flat write capabilities gate data entry (no ownership dimension). Reads are
open: any signed-in user can browse companies, contacts, opportunities, and projects.

- **`crm.edit`** — add/edit CRM companies, contacts *and* opportunities (including
  creating a company or contact inline from another CRM form).
- **`projects.edit`** — add/edit projects and their staffing (delivery managers and
  roles). Its type-ahead staff/company pickers have their own `projects.edit`-gated
  search actions (`src/actions/projects/searchStaff.ts` / `searchCompanies.ts`), so a
  delivery manager can staff a project without gaining CRM write access.

A capability gates editing **other people's / locked** timesheets:

- **`timesheets.edit`** — edit *any* timesheet, bypassing both the owner check and
  the ±1-week edit window. A normal user may always edit their *own* timesheet while
  it's within the window (last / this / next week) with no permission; editing another
  person's timesheet, or their own outside that window, requires this capability
  (manager/admin). Enforced by the `authorizeTimesheetEdit` hook (input-dependent, so
  it can't be a static permission alone). See the
  [timesheets domain](timesheets.md).

One capability gates a **read** rather than a write:

- **`feedback.review`** — view *all* peer feedback in full (the manager/admin
  oversight view). It does NOT gate *giving* feedback: any active staff member may
  leave feedback about any other active staff member (enforced by the
  `authorizeFeedbackCreate` hook, not a capability). And it is not needed to read
  feedback *about yourself* — recipients always see the limited recipient view
  (message + giver name only), and givers always see the feedback they wrote. See
  the [performance domain](performance.md) and
  [ADR 0023](../decisions/0023-feedback-privacy-tiers.md).

A resource with **two actions** gates staff overall ratings (levels L0–L4), a
sensitive read/write with **no ownership dimension** — unlike compensation or
feedback, a staffer never sees their *own* rating:

- **`ratings.view`** — view staff overall levels: the per-level analytics breakdown
  in the `/performance` dashboard's staff-levels section (headcount, comp/rate
  aggregates, distribution) and the edit page's current levels. Manager/admin only;
  there is no self-view path.
- **`ratings.edit`** — assign / change levels and save an evaluation (a new dated
  `staff_rating` row). Manager/admin only. See the [performance domain](performance.md).

## Roles → permissions (the canonical matrix — THIS IS THE CONTRACT)

Single role per user. Roles are stored in `user.role` (text). This table is the
contract; it is asserted by `src/lib/auth/permissions.test.ts` (runs in `bun run check`
via `bun test`) and audited by `/audit-rbac`. **Changing it requires changing the
`roles` map in `permissions.ts`, the test, and this table in lockstep** — that
friction is deliberate.

| Role               | `staff.edit` | `staff.viewCompensation` | `pto.review` | `crm.edit` | `projects.edit` | `feedback.review` | `ratings.view` | `ratings.edit` | `timesheets.edit` | Notes                                |
| ------------------ | :----------: | :----------------------: | :----------: | :--------: | :-------------: | :---------------: | :------------: | :------------: | :---------------: | ------------------------------------ |
| `user`             |      –       |            –             |      –       |     –      |        –        |         –         |       –        |       –        |         –         | default role for new users           |
| `delivery-manager` |      –       |            –             |      –       |     –      |        ✓        |         –         |       –        |       –        |         –         | owns projects & staffing             |
| `finance`          |      –       |            ✓             |      –       |     –      |        –        |         –         |       –        |       –        |         –         | views staff compensation (NOT ratings) |
| `sales`            |      –       |            –             |      –       |     ✓      |        –        |         –         |       –        |       –        |         –         | CRM data entry                       |
| `manager`          |      ✓       |            ✓             |      ✓       |     ✓      |        ✓        |         ✓         |       ✓        |       ✓        |         ✓         | all defined business perms           |
| `admin`            |      ✓       |            ✓             |      ✓       |     ✓      |        ✓        |         ✓         |       ✓        |       ✓        |         ✓         | + Better Auth admin-plugin user/session perms (`...adminAc.statements`) |

`DEFAULT_ROLE = "user"`, mirrored by `admin({ defaultRole: "user" })` in `auth.ts`.
`adminRoles: ["admin"]` lists which roles may call the admin-plugin endpoints.

## Helpers — how to gate

All exported from `src/lib/auth/permissions.ts`. They are **pure and synchronous**,
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
- **`isAdmin(user): boolean`** — true when the user holds the top `admin` role. The
  one place the `"admin"` literal lives for coarse role gating (e.g. `checkAuth("admin")`),
  so access-control logic stays in this module. Prefer `userHasPermission` for
  specific capabilities.
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
set. The metadata schema in `src/lib/core/action.ts` carries `role`, `permission`, and
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

- **`src/actions/staff/canEditStaff.ts`** — the staff-edit decision point
  (ADR 0014). Exports two things:
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
- **`src/actions/staff/canViewCompensation.ts`** — the comp-visibility decision
  point (mirrors `canEditStaff`). **`canViewCompensation(user, targetStaffId):
  Promise<boolean>`** — a user may **always** see their **own** compensation; seeing
  anyone else's requires `staff.viewCompensation`. Because history renders in a client
  component (the profile's tabbed panel), this gates comp both as a UI affordance (the profile comp card) *and* at
  the read: there is **no separate `COMPENSATION` category** — comp amounts ride each
  `EMPLOYMENT` entry's summary, and when the flag is false `getStaffHistory` drops
  those amounts from the summary, so salary never leaves the server for an
  unauthorized viewer.
- **`src/actions/staff/getStaffPto.ts`** — self-scoping read. Own PTO always
  visible; viewing another person's aggregated PTO requires `pto.review`, else it
  returns `null` and `ProfileView` hides the section (graceful, not an error).
  (Reads are plain server-only functions, not actions, so they call the helpers
  inline rather than via a composed client.)
- **`src/actions/allocations/getAllocationsGrid.ts`** — the (ungated, company-wide)
  allocations planner read. A **second `pto.review` enforcement site**: the planner
  shows everyone a reason-free "Away" strip, but reveals the leave **`type`** only to
  a `pto.review` holder — `canSeePtoType = userHasPermission(user, { pto: ["review"] })`,
  and the `type` field is **nulled** in the projection otherwise, so the reason never
  leaves the server. Minimal disclosure, not a loosening of the PTO gate — see
  [ADR 0038](../decisions/0038-allocations-planner-pto-disclosure.md).

## Wiring

- `src/lib/auth/auth.ts`: `admin({ ac, roles, adminRoles: ["admin"], defaultRole: "user" })`.
- `src/lib/auth/auth-client.ts`: `adminClient({ ac, roles })` — so the client API
  (`authClient.admin.hasPermission` / `checkRolePermission`) stays in sync with the
  server. Note: server-side gating uses the pure helpers above, not the client API.
- **`user.role` stays a `text()` column.** Better Auth owns `auth-schema.ts`
  (regenerated by `bun run auth:generate`); a `pgEnum` there would be clobbered on
  the next generate. Validity is enforced at the app layer by `roleSchema`. (Optional
  later hardening: a DB `CHECK` constraint in a hand-written migration.)

## Assigning roles — the local-only Manage Users tool

There is a **local-only** role/ban admin: `/admin/manage-users` (in the
host-gated admin area, [ADR 0008](../decisions/0008-localhost-only-admin-area.md)).
A TanStack table lists every application user with inline-editable **role** (Select)
and **banned** (Switch) cells, client-side search + role/banned filters, a floating
save bar, and a confirm dialog showing per-user old→new diffs before committing
(mirrors the bulk-edit-roles UX). New users still get `DEFAULT_ROLE` (`user`); roles
can also be set directly in the DB or via `auth.api.setRole`.

Two things make this tool different from the other admin tools (which are
`publicActionClient` + `assertLocalhost()`):

- **Mutations go through the Better Auth admin API**, not direct column writes:
  `commitUserChanges` (`src/actions/admin/commitUserChanges.ts`) calls
  `auth.api.setRole` / `banUser` / `unbanUser`. Reason: a ban must **revoke the
  user's sessions**, which the admin API does and a raw `user.banned` write would
  not. (Deliberate contrast with `commitBulkEditEmployment`, which writes Drizzle
  directly because employment facts are plain domain data with no session side
  effect.) It re-reads current role/banned, drops no-ops, and never trusts the
  client payload; every role validates against `roleSchema` first.
- **Gated with `secureActionClient` + `metadata({ role: "admin" })`** (not
  `publicActionClient`) *plus* `assertLocalhost()`. The admin API endpoints require
  the **caller** to be an admin, so the action both forwards the caller's session
  headers and asserts the admin role. **Bootstrapping caveat:** the signed-in local
  developer must already hold `admin` to use the tool — the *first* admin must be set
  directly in the DB or via `auth.api.setRole` (chicken-and-egg). Read side:
  `getUsers` (`src/actions/admin/getUsers.ts`, server-only) returns
  `UserAdminRow[]`, narrowing role via `isAppRole` and normalizing `banned` to a
  boolean.

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
- **`src/lib/auth/permissions.test.ts`** — asserts the canonical matrix; fails `bun run
  check` if any role's permission set drifts.
- **AGENTS.md** carries a "Permissions (RBAC) — never break them" pointer.

## Out of scope (deferred)

- A *production* (non-localhost) role-management UI · multiple roles per user ·
  DB-level role enum / CHECK constraint · the aggregated-PTO-summary UI (only the
  permission + read guard are built). See
  [ADR 0014](../decisions/0014-rbac-better-auth-access-control.md). (Local
  role/ban management exists — see _Assigning roles_ above.)
