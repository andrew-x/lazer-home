# 0050 — Peer feedback on the staff profile: per-person browse for reviewers, recipient tier for self

**Status:** accepted · 2026-07-29 · extends
[ADR 0023](./0023-feedback-privacy-tiers.md) (tiers unchanged) and
[ADR 0047](./0047-feedback-reports-scoping-not-granting.md) (same "no new capability"
reasoning, applied to a second browse surface)

## Context

Peer feedback lived only on `/feedback`: "About you" (the limited recipient
projection), "You've given", and — for a `feedback.review` holder — "Your reports"
(ADR 0047) plus the single-item detail page `/feedback/[id]`. **Browse-all across
everyone's feedback remains deferred** (ADR 0023 tier 3).

Two surfaces then needed feedback *about one named person*: the staff profile itself,
and the new read-only profile drawer opened from a compensation-plan row (see
[ADR 0049](./0049-review-notes-reporting-line-as-authorization-boundary.md) and
[ui.md](../ui.md)). A reviewer preparing a comp decision or a review conversation has
one person in mind, and had no way to see their feedback short of already knowing item
ids. "Your reports" only covers direct reports, which is not the same set as "the
cohort in this plan".

The two risks: (a) reintroducing browse-all by the back door, and (b) accidentally
*widening* ADR 0023's known self-view gap — a `feedback.review` holder can read their
own feedback in full via `/feedback/[id]` — into a browsable list on their own
profile.

## Decision

**Add a `Peer feedback` tab to the staff profile, backed by one read
(`getFeedbackAboutStaff`) that returns a two-tier tagged union, with the self branch
checked FIRST.**

1. **Self first, and it's the *limited* tier.** If the caller's linked staff id equals
   the profile's, the read returns `{ tier: "recipient", rows }` by delegating to the
   existing `getFeedbackAboutMe` — **even when the caller holds `feedback.review`.**
   So on your own profile you see exactly what any recipient sees: giver name,
   `messageToRecipient`, date. This is a deliberate **tightening**: it declines to
   widen ADR 0023's accepted self-view gap, which stays open only via
   `/feedback/[id]`. The ordering *is* the decision — check the capability first and
   the tightening evaporates.
2. **Otherwise, `feedback.review` → full content, about any person.**
   `{ tier: "full", rows }`, the same projection `getFeedbackDetail` gives a reviewer,
   rendered through the shared `FeedbackDetailDialog`. **No new capability, no matrix
   change** — `permissions.ts`, its test and the matrix table are untouched (ADR 0014's
   lockstep rule isn't engaged), as are the schema, migrations and seed.
3. **This adds *discovery*, not access — and the widening is honest about its shape.**
   Every row listed is one the holder could already open in full at `/feedback/[id]`.
   What's new is that they no longer need the id: they can browse **any** person's
   feedback, **one person at a time**. That is the per-person form of the browse-all
   list ADR 0023/0047 deferred; it is strictly narrower (a person at a time, reached
   by navigating to them) and it is stated here plainly rather than buried.
   **Browse-all is still deferred** — no flat list over everyone, no pagination
   surface, no cross-person query.
4. **`null` hides the tab entirely.** Anyone who is neither the subject nor a reviewer
   gets `null`, and neither the profile nor the drawer renders a trigger or a panel —
   so the tab's *presence* never discloses that feedback exists. Same convention as
   ADR 0047 §5 (`[]` still means "permitted, nothing yet" and renders an empty state).
5. **One panel, three hosts.** `staff-feedback-panel.tsx` takes plain data plus the
   person's name and holds no reads of its own, so `/staff/[id]`, `/profile` and the
   profile drawer can't drift in what they reveal. It reuses `FeedbackAboutMe` for the
   recipient tier and the shared `FeedbackDetailDialog` for the full tier — the panel
   supplies `recipientName` from its `staffName` prop, since a per-person read has no
   reason to repeat the recipient on every row. It also **says which tier the viewer is
   in**, out loud ("As a reviewer you can see each item in full — they can't").

## Consequences

- **The profile tab set is viewer-dependent.** Together with the Review notes tab
  ([ADR 0049](./0049-review-notes-reporting-line-as-authorization-boundary.md)) the
  profile now renders **5 to 7 tabs** depending on who is looking. Anything keying off
  the tab set (deep links, tests) must tolerate the range; tab state is uncontrolled
  and not in the URL, the same posture as `/feedback` (ADR 0047).
- **`/profile` deliberately does not hard-code this one.** It hard-codes `canEdit` and
  `canViewCompensation` (own profile ⇒ true), but passes the *read's* answer for
  feedback — because "it's your profile" is exactly the case that must yield the
  **narrower** tier.
- **The recipient tier is now reachable two ways** (`/feedback` "About you" and your
  own profile tab) over one read, so any future change to `getFeedbackAboutMe`'s
  projection changes both. That's the intended coupling — ADR 0023's
  "`messageToRecipient` is the one recipient-visible content field" rule holds
  everywhere or nowhere.
- **Reviewers gain a fast path to their own team's feedback that isn't the reports
  tab.** "Your reports" is still the only *aggregated* view; the profile tab is
  per-person. If the two ever feel redundant, the reports tab is the one with the
  narrower gate story — don't collapse them without revisiting ADR 0047.
- **The drawer ships full feedback content to the client** for a reviewer, inside
  `loadStaffProfileDrawer`'s response. That is sound because it's the same content
  `/feedback/[id]` already ships to the same viewer — **the justification is the gate the
  field carries, not the field being absent.** That drawer payload has since grown
  compensation, PTO and the history feed, each behind its own gate, and this tab is one of
  four gated slices in it; the standing rule for the payload is that **every sensitive
  field is gated at the read, and `null` means "not permitted", never "none on file"**
  (see [staff-profiles.md](../domains/staff-profiles.md) → *The read-only profile drawer*
  and [permissions.md](../domains/permissions.md)).

## Alternatives considered

- **A new capability for the profile tab.** Rejected for ADR 0047's reason, verbatim:
  the surface reveals nothing `feedback.review` doesn't already permit, so a second
  gate would add matrix/test/doc churn and a drift risk while changing no exposure.
  Gates should track *what may be seen*, not *which screen shows it*.
- **Show the full tier on your own profile too** (i.e. just check the capability
  first). Rejected — it would turn ADR 0023's accepted single-item gap into a
  comfortable browsable list of your own feedback, which is precisely the widening ADR
  0047 §4 refused to allow via a bad `managerId`.
- **Restrict the tab to the viewer's direct reports** (reuse the reports scoping).
  Rejected: the drawer's whole point is a comp-plan cohort, which is not a reporting
  subtree, and the caller can already open every one of those items by id. Scoping
  here would be a UI limitation dressed as a boundary.
- **Reinstate browse-all instead**, and let people find a person through it. Rejected
  as before (ADR 0023 tier 3, ADR 0047): maximal exposure for a need that is always
  "this one person".
- **Route the tab through `/feedback` with a `?for=` filter.** Rejected: the person is
  the context here, and duplicating the profile's identity header on the feedback page
  buys nothing. Keeping the panel presentational instead lets the profile, `/profile`,
  and the drawer share one implementation.
