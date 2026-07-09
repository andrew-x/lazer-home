# 0023 — Peer feedback: privacy tiers as read-projections; giving open, review gated

**Status:** accepted · 2026-07-09

## Context

The first slice of the performance domain is **peer feedback**: any teammate can
leave structured feedback about another (rating, context, keep/stop/start, an
optional message). Feedback is sensitive — most of it is meant for the giver and
for managers, and only a small part for the recipient. Two design questions had to
be settled: (1) **who may give** feedback and (2) **who may read which fields**.

The existing RBAC model (capabilities in `src/lib/permissions.ts`, enforced via
action metadata / server-only read guards — [ADR 0014](./0014-rbac-better-auth-access-control.md))
gates *actions* by role, but feedback needs a **column-level** distinction (a
recipient sees one field; a reviewer sees all) and an **input-dependent** giver
check (you can only write about a distinct active person, as yourself) — neither
of which is a plain static capability.

Note the environment: there is **no per-person reporting graph** in this codebase.
"Manager" is only ever a role, never "my manager". So "who can review feedback"
can only be role-based, not relationship-based.

## Decision

**Three tiers, with the privacy boundary living in the read projections, not the
table.** The `feedback` row stores everything; each read returns only what its
audience may see, so hidden columns never leave the server.

1. **Giving is open, not a capability.** Any **active** staff member may leave
   feedback about any **other** active staff member. Enforced by an
   input-dependent `authorize` hook — `authorizeFeedbackCreate` → `canGiveFeedback`
   (`src/actions/feedback/authorizeFeedback.ts`), mirroring `authorizeStaffEdit` /
   `canEditStaff`. It resolves the caller's active `staff` row from the session,
   forbids self-feedback, and requires the target to be active. `fromStaffId` is
   taken from the session, never the client. There is **no `feedback.give`
   capability** — every role can do it.
2. **Recipient sees a limited projection.** `getFeedbackAboutMe` selects **only**
   the giver's name, `messageToRecipient`, and date — never rating, context, or
   keep/stop/start/other. `getFeedbackDetail` likewise refuses full content to a
   mere recipient.
3. **Review is a capability.** A single new **`feedback.review`** permission
   (manager + admin) unlocks full oversight. It currently surfaces via
   `getFeedbackDetail`, which returns full content of **any** single feedback item
   to a holder of the capability (the `/feedback/[id]` detail page). The giver also
   always sees their own feedback in full (they wrote it), with no capability. A
   paginated **browse-all list** across everyone's feedback was built and then
   removed for now (`getAllFeedbackPage`); it is **deferred**. The capability and
   its matrix row are unchanged — only that one read surface was pulled.

**Deliberate deferral:** `feedback.review` currently lets a reviewer see feedback
**about themselves** in full — `getFeedbackDetail` doesn't exclude the reviewer as
recipient. Accepted for the first slice; routing a reviewer's own feedback through
the limited recipient view is future work.

## Consequences

- **Adding a field forces a privacy decision.** Because each read names its columns
  explicitly (per [`.claude/rules/database.md`](../../.claude/rules/database.md)),
  a new `feedback` column is invisible until a read opts it in — so you must
  consciously decide which tier(s) see it. This is the intended safety property; do
  not switch these reads to `select *`.
- **`messageToRecipient` is the one recipient-visible content field.** Any future
  recipient-facing surface must keep to that; widening it is a privacy change, not a
  UI tweak.
- **The reviewer self-view gap is known.** Don't treat "reviewers see all feedback"
  as a guarantee that a manager can't read their own — until the deferral is closed,
  they can. Close it before relying on the opposite.
- Matrix/test/[permissions doc](../domains/permissions.md) updated in lockstep for
  `feedback.review` (the deliberate friction from ADR 0014).

## Alternatives considered

- **A `feedback.give` capability.** Rejected: feedback should be universal among
  active staff; a capability would be granted to everyone anyway, adding friction
  for no gate. The input-dependent hook (distinct active target, self resolved from
  session) is the real boundary.
- **Enforce privacy in the UI / a single read + client-side field hiding.**
  Rejected: sensitive columns would reach the client. The projection-as-boundary
  keeps hidden fields server-side, the same discipline as the rest of the reads.
- **A row-level `visibility` column or per-field ACL.** Rejected as over-built for
  three fixed tiers; role + projection covers it without schema machinery.
- **Relationship-based review (only *my reports'* feedback).** Not possible — there
  is no reporting graph in this codebase; review is necessarily role-scoped.
</content>
