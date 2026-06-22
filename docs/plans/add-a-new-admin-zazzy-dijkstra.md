# Plan: Admin "Manage Users" page

## Context

The admin area (`/admin/*`, localhost-gated) has tools for seeding/maintaining data
but no way to manage application **users** — their RBAC role and ban status. We need
a page that lists every user (name, role, banned), supports client-side filtering
(search + role dropdown + banned filter), lets an admin edit **role** and **banned**
inline, and commits all edits at once behind a floating save bar + a confirm dialog
that summarizes the per-user diffs (mirroring the existing **bulk-edit-roles**
feature). Bans/role changes go through the **Better Auth admin API** so a ban revokes
the user's sessions (a direct column write would not).

This is intentionally modeled on `src/components/admin/bulk-edit-roles.tsx` +
`src/actions/admin/commitBulkEditEmployment.ts` — the closest existing pattern.

## Key decisions (confirmed)

- **Mutation goes through Better Auth admin API**, not direct DB writes:
  `auth.api.setRole`, `auth.api.banUser`, `auth.api.unbanUser`. These endpoints
  require the **caller to be an admin** (`adminRoles: ["admin"]`) and block
  self-bans. → The commit action is gated with `secureActionClient` +
  `metadata.role: "admin"` (the admin override), which both satisfies the endpoints'
  session requirement and declares the gate per `.claude/rules/permissions.md`. We
  also keep the `assertLocalhost()` boundary used by the rest of `/admin`.
  - **Prerequisite to flag in the UI/PR:** the signed-in local developer must
    already have the `admin` role for the save to authorize (chicken-and-egg is
    inherent to the Better Auth choice). Surface a clear `serverError` toast if not.
- **Save flow = confirm-then-save** (like bulk-edit-roles): floating bar → "Save
  changes" opens a dialog listing per-user `old → new` diffs for role/banned →
  "Confirm & save" commits → success toast → `router.refresh()`.
- **Listing is a direct read** (client-side filtering, so no server filtering
  needed): a server-only `getUsers()` selecting from the `user` table, following the
  established read pattern (`getStaffDirectory`, `getStaffEmploymentForEdit`).

## Files to create

### 1. `src/actions/admin/getUsers.ts` (server-only read)
- `import "server-only"`. Export `type UserAdminRow = { id; name; email; role: AppRole | null; banned: boolean }` and `async function getUsers(): Promise<UserAdminRow[]>`.
- `db.select({ id, name, email, role, banned }).from(user).orderBy(asc(user.name))`.
  Normalize `banned` (nullable column) to `boolean` (`row.banned ?? false`).
- `user` table: `src/lib/db/auth-schema.ts` (fields `name`, `email`, `role`, `banned`).
- Pattern reference: `src/actions/staff/getStaffDirectory.ts`.

### 2. `src/actions/admin/updateUsers.schema.ts` (shared Zod schema)
- `userChangeSchema = z.object({ userId: z.string(), role: roleSchema, banned: z.boolean() })`
  — `roleSchema` from `src/lib/permissions.ts` (so role always validates against the matrix).
- `updateUsersSchema = z.object({ changes: z.array(userChangeSchema).min(1) })`.
- Export `type UserChange`. Lives in its own file (not the `'use server'` file) so the client can import it — per `.claude/rules/server-actions.md`.

### 3. `src/actions/admin/commitUserChanges.ts` (`'use server'` mutation)
- `secureActionClient.metadata({ action: "commit-user-changes", role: "admin" }).inputSchema(updateUsersSchema).action(...)`.
- Body:
  1. `await assertLocalhost()` (local boundary; `src/lib/admin.ts`).
  2. Re-read current `{ id, role, banned }` for the changed `userId`s from `user`
     (don't trust the client payload — mirrors `commitBulkEditEmployment`).
  3. For each change, drop no-ops; otherwise:
     - role differs → `auth.api.setRole({ body: { userId, role }, headers: await headers() })`
     - banned differs → `banned ? auth.api.banUser({ body: { userId }, ... }) : auth.api.unbanUser({ body: { userId }, ... })`
  4. Wrap Better Auth `APIError`s (e.g. self-ban, not-admin) and rethrow as
     `UserSafeActionError(...)` so the message reaches `result.serverError`.
  5. `revalidatePath("/admin/manage-users")`. Return `{ usersAffected: number }`.
- Reference: `src/actions/admin/commitBulkEditEmployment.ts` (re-read + drop-no-op + result shape); `auth` + `headers` usage from `src/lib/auth.ts:43`.

### 4. `src/components/admin/manage-users.tsx` (`"use client"`)
Mirror `bulk-edit-roles.tsx` structure, trimmed to two editable fields:
- Props: `{ users: UserAdminRow[] }`.
- Local edit state `Record<userId, { role; banned }>`; `isChanged`/`changedRows`
  helpers comparing draft vs original (same shape as bulk-edit).
- **Filters** (client-side, over the source list):
  - Search `Input type="search"` with `IconSearch` over `name` (and `email`).
  - **Role** dropdown filter (`SelectFilter` pattern) with options from `ROLE_SLUGS`
    + an "All" sentinel; labels via `humanizeEnum`.
  - **Banned** filter (`TriStateFilter` pattern: All / Banned / Not banned).
- **Table** (TanStack, like bulk-edit): columns `Name` (+ email muted subtitle),
  `Role` (inline `Select` cell), `Banned` (inline `Switch` cell). Changed rows
  highlighted `bg-primary/5`.
- **Floating save bar** when `changedRows.length > 0`:
  `fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur` →
  "N users changed", Discard, Save changes. Page wrapper uses `pb-28`.
- **Confirm dialog**: per-user diff list (`Role: old → new`, `Banned: Yes/No → Yes/No`)
  with strikethrough-old + arrow + bold-new, exactly like bulk-edit's dialog.
- `useAction(commitUserChanges, { onSuccess: toast.success(`Updated N users.`) + reset + close + router.refresh(), onError: toast.error(error.serverError ?? "…") })`.
- **Reuse note:** `SelectFilter`, `TriStateFilter`, `SortHeader`, and the
  Select/Switch cell editors are currently **local** to `bulk-edit-roles.tsx` (not
  exported). To keep the change additive, replicate the small ones needed here.
  Flag for the librarian as a future refactor: extract these into a shared
  `src/components/admin/_table-helpers.tsx`.

### 5. `src/app/admin/manage-users/page.tsx` (Server Component)
- `export const metadata = { title: "Manage users" }`.
- `const users = await getUsers();` then render heading + `<ManageUsers users={users} />`
  (segment is already localhost-gated by `src/app/admin/layout.tsx`).
- Reference: `src/app/admin/bulk-edit-roles/page.tsx`.

## Files to modify

### `src/app/admin/page.tsx`
Add a fourth entry to `ADMIN_TOOLS`: title "Manage users", href `/admin/manage-users`,
a Tabler icon (e.g. `IconUserShield` / `IconUsers`), description e.g. "Edit user roles
and ban status."

## After implementation
- Dispatch the **librarian** subagent (per AGENTS.md) with a summary: new admin
  Manage Users page, `getUsers` read + `commitUserChanges` action via Better Auth
  admin API, and the table-helpers extraction opportunity.

## Verification
1. `bun run check` (Biome + `tsc`) and `bun run build`.
2. Run `/audit-rbac` — the new mutation must declare its gate (`role: "admin"`) and
   role writes must validate via `roleSchema`. Address findings.
3. Manual (local, signed in as an **admin** user — set one admin role directly first
   if needed): visit `http://localhost:3000/admin/manage-users`.
   - Table lists users with name, role, banned.
   - Search, role dropdown, and banned filter narrow the list client-side.
   - Change a role and toggle banned → floating bar appears with the right count.
   - "Save changes" → confirm dialog shows correct per-user `old → new` diffs →
     "Confirm & save" → success toast; reload shows persisted values; a banned
     user's sessions are revoked (Better Auth).
   - Self-ban attempt surfaces a clear error toast (Better Auth blocks it).
   - Signed in as a **non-admin**: save fails with a permission error toast.
```
