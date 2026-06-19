---
description: Audit RBAC/permissions end-to-end — verify the role matrix, every action's gate, and that nothing bypasses access control. Read-only; flags vulnerabilities.
argument-hint: "[optional: a domain or path to scope the audit, e.g. \"staff\" or \"src/actions/crm\"]"
---

# Audit RBAC

Verify that permissioning is intact and matches intent. This is a **read-only
audit** — investigate and report; do NOT fix anything inline. The goal is to catch
any way a user could read or mutate data they shouldn't.

Scope for this run: **$ARGUMENTS** (if empty, audit the whole codebase).

Source of truth: `src/lib/permissions.ts` (statement, roles, helpers),
`docs/domains/permissions.md` (the canonical matrix and model), and the rule in
`.claude/rules/permissions.md`. Read all three first.

## Inviolable framing

Permissioning must never be broken. Treat any gap as a **security incident**, not a
style nit. Surface vulnerabilities loudly and first.

## Checks

Work through each. For every finding record: file:line, what's wrong, severity, and
the concrete fix (don't apply it).

1. **Matrix integrity.** Does the `roles` map in `permissions.ts` grant exactly
   what the canonical matrix in `docs/domains/permissions.md` says — no more, no
   less, for every role? Does `src/lib/permissions.test.ts` encode that same
   matrix, and does `bun test` pass? Flag any drift between code, test, and doc.

2. **Server/client sync.** Do `auth.ts` (`admin({ ac, roles, ... })`) and
   `auth-client.ts` (`adminClient({ ac, roles })`) reference the SAME `ac`/`roles`
   from `permissions.ts`? Flag any divergence. Confirm `adminRoles` and
   `defaultRole` are sane (default must be least-privilege).

3. **Every action is gated.** For each file in `src/actions/**`, confirm it either:
   uses `secureActionClient` with an appropriate `metadata.role` /
   `metadata.permission` / `metadata.authorize` (the generic ownership hook);
   **or** uses `publicActionClient` with an explicit justification comment. List
   any action that is effectively ungated (authenticated-but-unauthorized counts
   as a finding when it mutates or exposes others' data). Authorization should be
   declared in metadata, not hand-written in action bodies — flag checks buried in
   bodies.

4. **Row-level enforcement.** For every action/read that accepts a target id (a
   staffId, userId, record id from client input), verify there's an ownership OR
   permission check before the read/write — not just a route-level gate. A
   signed-in user must not be able to act on another user's row by changing an id.
   Pay special attention to `update*`, `delete*`, and `get*` of others' data.

5. **No DB access outside the actions layer.** Search for `db.insert`, `db.update`,
   `db.delete`, and `db.select` outside `src/actions/**` and `src/lib/**` helpers.
   The only allowed exceptions are framework wiring (`src/lib/auth.ts`) and pure
   compute helpers reached only through an action. Flag pages/components/loaders
   touching `db` directly.

6. **Reads don't leak.** For server-only `get*` reads that can return another
   person's data (e.g. PTO, profile internals), confirm they self-scope:
   own-data-always, others gated by the right permission, and they fail closed
   (return null / throw) rather than over-returning.

7. **Inline role checks.** Search for ad-hoc `role === "..."` / `role !== "..."`
   comparisons outside `permissions.ts`. These should go through
   `userHasPermission` / `requirePermission`. Flag each.

8. **Role values are validated.** Anywhere a role is set/accepted (e.g. an admin
   set-role path), confirm it validates against `roleSchema`. Flag raw string
   writes to `user.role`.

9. **Fail-closed defaults.** Confirm unknown/null roles resolve to no permissions
   (least privilege). Flag any code path that grants access on a missing/unknown
   role or swallows a denied check.

## Output

Produce a report:

- **🔴 Vulnerabilities** — anything exploitable now (ungated mutation, missing
  row-level check, leaking read, escalation). List first, most severe first.
- **🟡 Weaknesses** — gaps that aren't directly exploitable but erode the model
  (inline role checks, unvalidated role writes, matrix/doc drift).
- **🟢 Verified** — what you checked and found correct.

End with a one-line verdict: **PASS** (no 🔴) or **FAIL** (one or more 🔴), and the
recommended fixes. Do not modify any files.
