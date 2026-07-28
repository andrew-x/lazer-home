# 0047 — "Your reports" feedback list: the reporting line scopes, it never grants

**Status:** accepted · 2026-07-28 · companion to
[ADR 0023](./0023-feedback-privacy-tiers.md) (which **stands** — three tiers,
projection-as-boundary, `feedback.review` as the reviewer gate) and the first
non-display use of [ADR 0026](./0026-staff-manager-self-reference.md)'s
`staff.managerId`.

## Context

`/feedback` (relabelled **"Peer Feedback"**; route unchanged) had two tabs: "About
you" (the limited recipient projection) and "You've given". A reviewer
(`feedback.review` — manager/admin) could read **any** item in full, but only one at a
time, by already knowing its id and visiting `/feedback/[id]`. There was no list. The
paginated **browse-all** list built in the first slice was removed and remains deferred
([ADR 0023](./0023-feedback-privacy-tiers.md) tier 3): a flat firehose over everyone's
feedback is a lot of exposure for very little workflow.

The concrete need is narrower than browse-all: *a manager preparing to talk to one of
their people wants that person's feedback in one place.* Since ADR 0023 was written the
environment changed — **`staff.managerId` now exists** ([ADR 0026](./0026-staff-manager-self-reference.md)),
a durable, CSV-import-populated self-FK — so a relationship-scoped list is finally
expressible. ADR 0023 had rejected exactly that as "not possible"; that rejection was
about capability, not desirability.

The risk to get right: reintroducing a browse surface must not quietly become a **new
authorization path**. "Manager" as an English word means two unrelated things here — a
*role* in the permission matrix and a *reporting line* between two `staff` rows — and
conflating them is how a privacy model rots.

## Decision

**Ship a third tab, "Your reports (N)", gated on the unchanged `feedback.review`
capability, and use the reporting line only to *narrow* the list.**

1. **Same gate as the detail page — no new capability, no matrix change.**
   `getFeedbackAboutReports` (server-only read, `src/actions/feedback/`) checks
   `userHasPermission(user, { feedback: ["review"] })` — the *identical* capability
   `getFeedbackDetail` requires for full content. So **every row it lists is one the
   caller could already open in full at `/feedback/[id]`**; the tab adds discovery, not
   access. `permissions.ts`, `permissions.test.ts` and
   [domains/permissions.md](../domains/permissions.md) are **untouched** (so the ADR
   0014 lockstep rule isn't engaged), as are the schema, migrations and seed.
2. **Scoping, not granting.** The reporting line is applied as a `where` clause
   (`recipient.managerId = callerStaffId`) *after* the capability check, and it can
   only ever **remove** rows from a permitted set. It is **not** consulted by any
   permission check, and **not** a path to access for someone lacking
   `feedback.review`. This is the invariant to preserve: if a future change makes the
   reporting line decide *whether* someone may read something, that's a different
   decision and needs its own ADR.
3. **Direct reports only, one hop.** No recursive/transitive manager walk, so
   skip-levels don't appear. Chosen for predictability and a trivial query; it isn't a
   security boundary (widening it stays inside the same capability), so it can be
   relaxed without a privacy review.
4. **Self-excluded, on purpose** — the query also asserts `recipient.id ≠
   callerStaffId`. `managerId` has no in-app editor and no cycle detection beyond the
   importer's non-blocking `self` warning ([ADR 0026](./0026-staff-manager-self-reference.md)),
   so a self-pointing row is reachable through a bad CSV. Without the guard it would
   hand the caller **their own feedback in full** — precisely what the recipient tier
   withholds. ADR 0023's accepted self-view gap (a reviewer can still read their own
   item via `/feedback/[id]`) is unchanged, but it must not grow into a browsable list
   as a side effect of an import typo.
5. **`null` hides the tab; `[]` renders an empty state.** The read returns `null` when
   the caller lacks the capability *or* has no linked active `staff` row, and the page
   renders no trigger and no panel at all; `[]` means "permitted, nothing yet". Keeping
   these distinct avoids both showing a dead tab to non-reviewers and hiding the
   feature from an entitled manager whose reports simply have no feedback.
6. **Full content, shared dialog.** Rows carry the same projection
   `getFeedbackDetail` gives a reviewer, so the detail dialog was **extracted from
   `feedback-given-table` into `feedback-detail-dialog.tsx`** and is now shared. One
   dialog means the two full-content surfaces can't drift in what they reveal.
7. **In-memory filters (For / Author / From / To).** The staff-directory
   client-filtering pattern, not the URL-backed
   [list filter bar](../ui.md#list-filter-bars): the controls live inside an
   **uncontrolled `Tabs`**, so URL-backed filters would drag tab selection into the URL
   too, and one manager's reports is a small, already-fetched set.

## Consequences

- **`staff.managerId` is now load-bearing for visibility, not just display.** ADR 0026
  justified keeping it on `staff` (not effective-dated) partly because it was
  display-only. It still isn't effective-dated — the tab scopes on the *current*
  reporting line, with no as-of demand — but a **bad import now changes what a manager
  can conveniently see**, not just a profile line. The import's "preserve on
  unresolvable, clear only on a blank cell" rule is what keeps that safe; don't loosen
  it. This is also the first query in the **inverse** direction ("who reports to me").
- **Browse-all is still deferred.** This is deliberately the narrow version. If a
  browse-all list ever returns, it's a fresh exposure decision (pagination, audit,
  self-exclusion, whether `feedback.review` alone should carry it) — not an extension
  of this one.
- **The two senses of "manager" must stay separate in docs and code.** Any sentence of
  the form "managers see …" should say which it means. Older docs asserting "there is
  no manager/report graph in this codebase" are stale (corrected in ADR 0023,
  [domains/performance.md](../domains/performance.md) and [flows.md](../flows.md)).
- **Tab count is now viewer-dependent.** `/feedback` renders two tabs for most people
  and three for reviewers. Anything keying off the tab set (tests, deep links) must
  tolerate both; tab state is uncontrolled and not in the URL.

## Alternatives considered

- **A new capability (e.g. `feedback.reviewReports`) or a matrix row.** Rejected: the
  surface reveals nothing the existing `feedback.review` doesn't already permit, so a
  new capability would add matrix/test/doc churn and a second gate to keep in sync
  while changing no actual exposure. Gates should track *what may be seen*, not *which
  screen shows it*.
- **Make the reporting line the authorization boundary** (a manager may read only their
  reports' feedback; being someone's manager grants access without `feedback.review`).
  Rejected — and this is the important rejection. `managerId` is import-populated with
  no in-app editor, no cycle detection, and known warning cases; making it decide
  access would put the privacy model at the mercy of a CSV column. Role stays the gate.
- **Reinstate the full browse-all list instead.** Rejected as before: maximal exposure
  for a need that is almost always "one person I manage".
- **Recursive reports (whole sub-tree).** Rejected for now: needs a recursive CTE or
  repeated queries, and skip-level browsing wasn't the ask. Non-breaking to add later.
- **A "direct reports" section on the staff profile instead of a feedback tab.**
  Rejected for this slice: the profile has no reviewer-gated feedback surface at all,
  and the natural home for "feedback about my people" is the feedback page. (An inverse
  "direct reports" view on the profile still doesn't exist.)
- **Show the reports list to everyone, projected down to the recipient tier.**
  Rejected: it would let any staffer enumerate who reports to them *and* that they've
  received feedback — a new disclosure — for no workflow gain.
