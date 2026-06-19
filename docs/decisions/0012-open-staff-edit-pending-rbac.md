# 0012 — Staff link/intro edits are open to any authenticated user until RBAC lands

**Status:** superseded by [ADR 0014](./0014-rbac-better-auth-access-control.md) · 2026-06-17

> **Resolved 2026-06-18.** RBAC landed ([ADR 0014](./0014-rbac-better-auth-access-control.md),
> [domains/permissions.md](../domains/permissions.md)). The temporary gap described
> below is **closed**: `updateStaffLinks` and `updateStaffClientIntro` now declare
> `metadata({ authorize: authorizeStaffEdit })` — the `authorizeStaffEdit` hook
> (`src/actions/staff/canEditStaff.ts`) gates them via `canEditStaff` (own → always;
> other → `staff.edit`), and `getStaffPto` requires `pto.review` to read another
> person's PTO. The `// TODO: lock down` markers are gone. Kept for history; the
> Context/Decision below describe the superseded interim state.

## Context

The browse-staff feature added a directory (`/staff`) and per-person profile pages (`/staff/[id]`) that show *other people's* profiles, not just the signed-in user's own (`/profile`). Those pages reuse the same `ProfileView`, which carries the existing edit affordances for **profile links** and **client intro**.

Before this feature, those two mutations were `updateMyLinks` / `updateMyClientIntro`: ownership was **structural** — the update targeted `WHERE staff.userId = ctx.user.id` and `.returning()` confirmed a row matched, so a caller could only ever edit their own record (see [ADR 0010](./0010-actions-layer-owns-db-access.md), which leans on reads/writes being inherently self-scoped). That scoping is fundamentally incompatible with editing someone else's profile from `/staff/[id]`.

The right long-term answer is **role-based access** (an admin / manager can edit anyone; a person can edit their own; everyone else is read-only). But that role model doesn't exist yet — there's no notion beyond the auth `user.role` admin flag, and no manager/report graph. Building it now would block shipping the directory.

## Decision

Rename the two mutations to `updateStaffLinks` / `updateStaffClientIntro`, have them take an explicit **`staffId`** and edit that row by id, and **deliberately drop the owner-scoping**. Any authenticated user can currently edit any staff member's links and client intro. The edit dialogs (`edit-links-dialog.tsx`, `edit-client-intro-dialog.tsx`) take a `staffId` prop so both `/profile` (own id) and `/staff/[id]` (target id) use the same components.

`secureActionClient` still applies, so a **valid session is required** — this is "any logged-in employee," not "the public." Both actions are flagged `// TODO: lock down to owner/admin later`. The reads (`getStaffProfile`, `getStaffHistory`, `getStaffPto`, `getStaffAvatar`) are likewise **not** ownership-scoped by design — the directory must show other people; the `(app)` layout's session+staff gate is the only access boundary today.

This is consistent with the app's current **internal-only, trusted-employee** posture (cf. the localhost-only admin importers, [ADR 0008](./0008-localhost-only-admin-area.md)): the data here (name, role, links, client intro) is not the sensitive tier (rates/salaries/reviews) that motivated the metadata-driven authz model.

## Consequences

- **Row-level authz is temporarily absent** on these two mutations — a regression against the [architecture authz model](../architecture.md#authorization--rbac-declared-in-action-metadata), accepted knowingly to unblock the directory. Anyone signed in can rewrite anyone's links/intro. This is why it's logged here rather than left implicit in a TODO.
- **Inactive staff profiles are readable by direct `/staff/[id]` URL** (the directory hides them behind the "active only" toggle, but the read isn't gated). Same open, internal-only rationale.
- When the role model lands, the lock-down is mechanical: re-add a row-level check in both actions (owner OR admin/manager via `ctx.user`), gate the edit affordances in `ProfileView` on the same, and revisit whether inactive/other-person reads need scoping. Search the `// TODO: lock down to owner/admin later` markers.
- This ADR **softens, for these two writes, the "inherently self-scoped" property** ADR 0010 described. ADR 0010's pattern still holds for genuinely personal reads; it was never an authz guarantee for cross-person data, which this feature is the first to introduce.

## Alternatives considered

- **Build the role model now** — rejected: large, and not required to ship a read-mostly directory; would gold-plate before we know the manager/report shape.
- **Keep edits self-only, make `/staff/[id]` read-only** — viable and safer, but the reused `ProfileView` already carries the edit dialogs and the product wanted them live; we chose to open up rather than fork the component into edit/read-only variants now.
- **Gate edits on the `user.role` admin flag** — rejected as the *interim* state: too restrictive (a person couldn't edit their own profile from `/staff/[id]`) and still not the real owner/manager model; deferring entirely keeps the temporary state simple and obviously-temporary.
