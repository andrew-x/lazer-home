# 0040 — Allocation notes on `staff`: planner-inline, gated on static `staff.edit` (no owner path)

**Status:** accepted · 2026-07-24

## Context

Staffing a consultancy needs a place to jot a **plain planning note about a person**
— "on bench after Aug 15", "wants frontend work", "rolling off Acme end of month".
The natural home is the **allocations planner** (`/allocations`), the one company-wide
view of who's on what week by week. Two questions:

1. **Where does the note live?** It's a note about a *person's* staffing, not about a
   particular `project_roles` line or an effective-dated employment fact.
2. **Who may see and edit it?** Every other staff-field edit (`updateStaffLinks`,
   `updateStaffClientIntro`, `updateStaffResume`, `updateStaffSkills`, the survey
   `upsertResponse`) uses the **owner-or-`staff.edit`** `authorizeStaffEdit` hook: a
   person may always edit their *own* profile; editing anyone else's needs `staff.edit`
   (see [domains/permissions.md](../domains/permissions.md),
   [ADR 0014](./0014-rbac-better-auth-access-control.md)). Do allocation notes follow
   that same ownership rule?

## Decision

**Store `allocationNotes` as a nullable `text()` column on the durable `staff` row,
and gate it — read *and* write — on the static `staff.edit` capability with no owner
path.**

- **Column:** `staff.allocationNotes text` (nullable; `drizzle/0006_empty_whirlwind.sql`).
  On `staff` (durable identity), **not** `staff_employment` — it's a free-form planning
  note, not an effective-dated fact, so history-as-rows would be noise. **No `updatedAt`
  sibling** (unlike `clientIntro`/`resume`): it's not surfaced with a "last edited" stamp
  anywhere.
- **Write:** `updateStaffAllocationNotes` (`src/actions/staff/updateStaffAllocationNotes.ts`,
  schema in the client-importable `.schema.ts`) declares
  `metadata.permission: { staff: ["edit"] }` — the **static** capability, enforced by
  `secureActionClient` before the body. It **does not** use `authorizeStaffEdit`, so
  **there is no owner path**: a person cannot edit their own allocation note; only
  managers/admins (`staff.edit`) can. Revalidates `/allocations`.
- **Read:** `getAllocationsGrid` computes `canEditNotes = userHasPermission(user,
  { staff: ["edit"] })` and only projects the note value when true — the string **never
  ships to an unprivileged client** (defense in depth). The planner renders the Notes
  column only when `canEditNotes`.
- **No new capability, no matrix change** — this reuses `staff.edit`; `permissions.ts`,
  its test, and [domains/permissions.md](../domains/permissions.md) are untouched. This
  ADR records a new *use site* and a deliberate deviation from the ownership rule.

## Consequences

- **These notes are manager/admin-only, both to see and to edit** — the only `staff`
  field where the owner can't touch their own data. That's intentional: they're
  *about* a person for staffing decisions, not *by* them, and can be candid.
- The Notes column disappears entirely for non-`staff.edit` viewers — no empty column,
  no leaked hint that notes exist.
- Mirrors the enforcement style of [ADR 0038](./0038-allocations-planner-pto-disclosure.md)
  (the PTO leave-reason gate on the same planner): the sensitive field is gated at the
  **read projection**, not just hidden in the UI.

## Alternatives considered

- **Use the owner-or-`staff.edit` `authorizeStaffEdit` hook** (like every other staff
  field). Rejected — it would let anyone edit their *own* allocation note, which isn't
  the intent for cross-person staffing metadata on a management planner, and would leak
  the value to every signed-in client for their own row.
- **A new dedicated capability** (e.g. `staff.editAllocationNotes`). Rejected as
  over-engineering — the population that plans staffing is exactly the `staff.edit`
  population; a separate row would bloat the matrix for no distinct audience.
- **Store on `project_roles` or a separate notes table.** Rejected — the note is about
  the *person*, not any one allocation line; a single nullable column on `staff` is the
  minimal fit.
- **Effective-dated on `staff_employment`.** Rejected — a scratch planning note has no
  as-of-history demand; churning employment rows for note edits would be noise.
