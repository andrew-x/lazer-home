# 0038 — Allocations planner: public availability, gated leave reason

**Status:** accepted · 2026-07-24

## Context

The new **allocations planner** (`/allocations`) is a **read-only, company-wide**
view of who is staffed on what, week by week — deliberately **visible to everyone
signed in** (no permission gate), the same open-read posture the staff directory,
companies, contacts, opportunities, and projects lists already take. It surfaces
three things per person-week: project allocations (from `project_roles`) and **time
off** (from `staff_pto`).

That last one collides with an existing RBAC rule. Viewing **another** person's PTO
— specifically the leave **type / reason** — is a manager/admin capability
(**`pto.review`**; own PTO is always visible). See
[domains/permissions.md](../domains/permissions.md). A planner that showed everyone
each colleague's leave *reason* would silently widen that gate to the whole company.
But a capacity planner is far less useful if it can't show that someone is simply
*unavailable* a given week.

So: how do we show cross-staff **availability** (which the planner needs) without
disclosing the **reason** (which `pto.review` protects)?

## Decision

**Split the disclosure. Everyone sees availability; only `pto.review` holders see
the leave type — enforced in the read, not the UI.**

- The planner renders a neutral **"Away"** strip for any week a person has approved
  time off. That is an *availability* signal only — no type, no reason.
- The leave **`type`** is revealed **only** to a viewer who holds **`pto.review`**.
  `getAllocationsGrid` (`src/actions/allocations/getAllocationsGrid.ts`) computes
  `canSeePtoType = userHasPermission(user, { pto: ["review"] })` and, when false,
  **nulls the `type` field** on every `AllocationTimeOff` row before it leaves the
  server. The hidden value never reaches the client — this is a projection-level
  gate, exactly like the feedback privacy tiers ([ADR 0023](./0023-feedback-privacy-tiers.md)),
  not a client-side hide.
- **Only approved (non-pending) leave is shown** (`staff_pto.isPending = false`), so
  the planner never surfaces speculative or unapproved absences.

The `type` on `AllocationTimeOff` / `TimeOffCell` is therefore typed `PtoType | null`
by design; `null` means "away, reason withheld," not "unknown."

## Consequences

- **The `pto.review` gate is preserved, not loosened.** A non-manager learns only
  that a colleague is unavailable a week — the same thing they'd infer from an empty
  allocation anyway — never *why*. Managers/admins get the full picture in one view.
- **No new capability, no matrix change.** This reuses `pto.review`; the
  `permissions.ts` matrix, its test, and [domains/permissions.md](../domains/permissions.md)
  are untouched. This ADR just records a **new enforcement site** for an existing
  capability.
- The planner itself needs **no route gate** — the sensitive field is gated at the
  read, and everything else on the page (staff identity, project allocations) is
  already open-read.

## Alternatives considered

- **Gate the whole page on `pto.review`.** Rejected — capacity/availability is
  useful to everyone (a delivery manager planning staffing, an IC seeing who's
  around), and most of the page (allocations) isn't PTO at all. Gating the page to
  managers would hide far more than the protected field.
- **Show the type to everyone.** Rejected — a direct violation of the `pto.review`
  gate; leave reasons are sensitive.
- **Omit time off entirely** (show only allocations). Rejected — availability is
  half the point of a capacity planner; a week that *looks* free but is actually PTO
  would mislead staffing decisions. Showing a reason-free "Away" is the minimal
  disclosure that keeps the view honest.
