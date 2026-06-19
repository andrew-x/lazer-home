---
paths:
  - "src/lib/permissions.ts"
  - "src/lib/permissions.test.ts"
  - "src/lib/auth.ts"
  - "src/lib/auth-client.ts"
  - "src/lib/action.ts"
  - "src/actions/**"
---

# Permissions (RBAC) — the inviolable rule

This system has access control. **Permissioning must never be broken.** Treat any
gap as a security incident, not a refactor opportunity.

`src/lib/permissions.ts` is the **single source of truth**: the statement
(resources/actions), the roles, the role→permission matrix, and the `userHasPermission`
/ `requirePermission` helpers. Better Auth (`admin` plugin) enforces through these.
The canonical matrix is documented in `docs/domains/permissions.md` and asserted by
`src/lib/permissions.test.ts`.

## The inviolable rule

**Never weaken, bypass, or work around a permission check.** If you discover a way
to read or mutate data you shouldn't — a missing gate, an action that skips
ownership, a read that leaks another user's data, an escalation path, a role that
grants more than its matrix row — **STOP and flag it immediately and prominently.**
Do not silently route around it, do not "temporarily" loosen it, do not leave a
TODO. Surface it to the user as a vulnerability before doing anything else.

## Non-negotiables when touching these files

- **Every mutating/sensitive action declares a gate** — `metadata.permission`
  (capability), `metadata.role`, and/or a row-level `requirePermission` /
  ownership check in the body — OR carries an explicit, justified comment for why
  it is intentionally public. No silent ungated mutations.
- **Input-dependent / ownership checks are mandatory** wherever an action accepts
  a target id it could mutate or read across users. Declare them with the generic
  **`metadata({ authorize })` hook** (an `ActionAuthorize` that reads `clientInput`),
  enforced by `secureActionClient` before the body — never hand-written inside the
  body. The hook is reusable for any future permission, not staff-specific. Route-
  level gates alone are not enough. (Pattern: `authorizeStaffEdit` → `canEditStaff`
  — owner always; others need `staff.edit`.)
- **All DB access goes through the actions layer** (see `server-actions.md`). Never
  add `db.insert/update/delete` to a page/component/loader.
- **`permissions.ts` is the only place access-control logic lives.** Don't
  re-implement role checks inline (`user.role === "manager"`); call the helpers.
- **Keep the three in lockstep:** the `roles` matrix in `permissions.ts`, the
  matrix test, and `docs/domains/permissions.md`. Changing one requires changing
  all three — that is deliberate friction.
- **`user.role` values must validate against `roleSchema`.** Never write an
  arbitrary string into the role column.
- **Default to deny.** Unknown/null roles get no permissions. Never invert that.

## Before claiming permissions work is done

Run `/audit-rbac` and address what it finds. `bun run check` runs the matrix test;
it must pass.
