# 0023 — Peer feedback: privacy tiers as read-projections; giving open, review gated

**Status:** accepted · 2026-07-09 · **factually corrected 2026-07-28 and again
2026-07-29** (see the "**Correction**" notes below,
[ADR 0047](./0047-feedback-reports-scoping-not-granting.md),
[ADR 0049](./0049-review-notes-reporting-line-as-authorization-boundary.md) and
[ADR 0050](./0050-profile-peer-feedback-tab.md) — the **decision stands unchanged**;
what was stale is the environmental claim that no reporting graph exists, and then the
claim that no permission check reads one)

## Context

The first slice of the performance domain is **peer feedback**: any teammate can
leave structured feedback about another (rating, context, keep/stop/start, an
optional message). Feedback is sensitive — most of it is meant for the giver and
for managers, and only a small part for the recipient. Two design questions had to
be settled: (1) **who may give** feedback and (2) **who may read which fields**.

The existing RBAC model (capabilities in `src/lib/auth/permissions.ts`, enforced via
action metadata / server-only read guards — [ADR 0014](./0014-rbac-better-auth-access-control.md))
gates *actions* by role, but feedback needs a **column-level** distinction (a
recipient sees one field; a reviewer sees all) and an **input-dependent** giver
check (you can only write about a distinct active person, as yourself) — neither
of which is a plain static capability.

Note the environment **as it stood when this ADR was written (2026-07-09)**: there was
**no per-person reporting graph** in the codebase — "Manager" was only ever a role,
never "my manager" — so "who can review feedback" could only be role-based.

> **Correction (2026-07-28).** A reporting graph now exists: `staff.managerId`, a
> durable, import-populated self-FK added by
> [ADR 0026](./0026-staff-manager-self-reference.md). This does **not** change the
> decision below: **authorization is still purely role-based** — no permission check
> reads the reporting line. The graph is used only to **scope** one reviewer browse
> list ("Your reports" on `/feedback`), narrowing a set the caller was already
> entitled to see in full. **Scoping is not granting**; see
> [ADR 0047](./0047-feedback-reports-scoping-not-granting.md).
>
> **Correction (2026-07-29) — "no permission check reads the reporting line" is no
> longer true of the codebase.** It is still true **of feedback**, which is what this
> ADR governs: every feedback read is gated on the unchanged `feedback.review`
> capability (or the recipient/giver paths), and `managerId` still only scopes.
> But a *different* entity — **performance review notes** — now makes
> `staff.managerId` an authorization **input**
> ([ADR 0049](./0049-review-notes-reporting-line-as-authorization-boundary.md)). So
> don't read the sentence above as a codebase-wide invariant; read it as a property of
> the feedback model. Feedback also gained a second reviewer browse surface — a
> per-person **profile tab** — under the same unchanged capability, with the **self
> branch deliberately checked first** so your own profile shows the *recipient* tier
> and the deferral below isn't widened
> ([ADR 0050](./0050-profile-peer-feedback-tab.md)).

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
   its matrix row are unchanged — only that one read surface was pulled. *(Since
   2026-07-28 the same capability also backs one **narrowed** browse list — the
   caller's direct reports, [ADR 0047](./0047-feedback-reports-scoping-not-granting.md)
   — and since 2026-07-29 a **per-person** one, the staff-profile "Peer feedback" tab
   ([ADR 0050](./0050-profile-peer-feedback-tab.md)). Browse-**all** is still
   deferred.)*

**Deliberate deferral:** `feedback.review` currently lets a reviewer see feedback
**about themselves** in full — `getFeedbackDetail` doesn't exclude the reviewer as
recipient. Accepted for the first slice; routing a reviewer's own feedback through
the limited recipient view is future work. *(Both browse surfaces built since refuse
to widen it: "Your reports" excludes the caller as recipient
([ADR 0047](./0047-feedback-reports-scoping-not-granting.md)), and the profile tab
returns the **recipient** tier on your own profile even if you hold the capability
([ADR 0050](./0050-profile-peer-feedback-tab.md)). The gap remains open only via
`/feedback/[id]`.)*

## Consequences

- **Adding a field forces a privacy decision.** Because each read names its columns
  explicitly (per [`.claude/rules/database.md`](../../.claude/rules/database.md)),
  a new `feedback` column is invisible until a read opts it in — so you must
  consciously decide which tier(s) see it. This is the intended safety property; do
  not switch these reads to `select *`.
- **`messageToRecipient` is the one recipient-visible content field.** Any future
  recipient-facing surface must keep to that; widening it is a privacy change, not a
  UI tweak.
- **The reviewer self-view gap is known and still open.** Don't treat "reviewers see
  all feedback" as a guarantee that a manager can't read their own — until the
  deferral is closed, they can, via `/feedback/[id]`. Close it before relying on the
  opposite. (The "Your reports" list deliberately **excludes the caller as recipient**
  so it can't widen this gap into a browsable list even when `managerId` points at
  the caller themselves — [ADR 0047](./0047-feedback-reports-scoping-not-granting.md).)
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
- **Relationship-based review (only *my reports'* feedback).** Rejected in 2026-07 as
  not possible — there was no reporting graph then, so review had to be role-scoped.
  > **Correction (2026-07-28).** This has **effectively shipped — as a *scoping*
  > mechanism, not as the gate.** `staff.managerId` ([ADR 0026](./0026-staff-manager-self-reference.md))
  > now backs the "Your reports" tab: the gate is still the unchanged
  > `feedback.review` capability, and the reporting line only narrows which permitted
  > rows are *listed*. What remains rejected is the stronger reading of this
  > alternative — making the reporting line the **authorization boundary** (i.e. a
  > manager may read *only* their reports' feedback, or a non-reviewer gains access by
  > being someone's manager). See
  > [ADR 0047](./0047-feedback-reports-scoping-not-granting.md).
