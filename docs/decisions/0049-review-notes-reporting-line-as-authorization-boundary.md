# 0049 — Performance review notes: the reporting line becomes an authorization boundary

**Status:** accepted · 2026-07-29 · **deliberately breaks the invariant
[ADR 0047](./0047-feedback-reports-scoping-not-granting.md) §2 states outright**
("if a future change makes the reporting line decide *whether* someone may read
something, that's a different decision and needs its own ADR"). This is that
decision. ADR 0047 still stands **for feedback**; review notes are the exception,
and the only one.

## Context

A **performance review note** is a manager's written record of a review
conversation with one of their people: dated, titled, free-text, and shareable with
the person it is about. It is the first piece of the broader review machinery
[performance.md](../domains/performance.md) has listed as *proposed* since the
domain's first slice.

The content is unusually private in a way nothing else in the app is. A comp plan
is a management artefact about a cohort; peer feedback is authored by peers and
already has a three-tier privacy model ([ADR 0023](./0023-feedback-privacy-tiers.md));
a rating is a bare L-number. A review note is a **two-party conversation** — "here
is what we discussed, here is what we agreed" — and the two parties are a specific
person and *their* manager. Nobody else was in the room.

Every gate in the codebase before this one is a **role capability**
(`src/lib/auth/permissions.ts`, [ADR 0014](./0014-rbac-better-auth-access-control.md)),
and ADR 0047 was explicit that the reporting graph must stay out of authorization:
`staff.managerId` was allowed to *scope* the feedback "Your reports" list but never
to *grant*. The obvious continuation would be a `reviews.*` capability. That does not
express the thing being protected: `manager` (the role) is held by every people
manager in the company, so a `reviews.read` capability would let any of them read any
report's private conversation with someone else. The privacy boundary here is not
"who is senior enough" — it is "who was in that relationship".

## Decision

**Make `staff.managerId` an authorization *input* for performance review notes, and
only for review notes.** The gate is the relationship, not a capability.

1. **One decision module, `src/actions/performance/reviewNoteAccess.ts`.** It is the
   *only* place in the codebase where `managerId` decides access. It exports
   `getReviewNoteAccess(user, staffId) → { callerStaffId, isSubject, canManage }`:
   - **`canManage`** = `isAdmin(user)` **OR** the caller's linked staff id equals the
     subject's **current** `staff.managerId`. Drafting, editing, sharing, deleting
     and reading drafts all hang off this.
   - **Role capabilities are not consulted at all.** Holding `ratings.edit` or
     `feedback.review` grants *nothing* here — a `manager`-role user who isn't this
     person's manager gets no more than a `user`-role one. Only `admin` is a
     blanket override (it already is everywhere).
   - **The caller is resolved with `ownStaffId(user.id, { activeOnly: true })`** — an
     *active* linked staff row, not merely a session. A terminated person keeps a valid
     session until it expires and their former reports' `managerId` still points at them
     **until the next CSV import**, so without this they could keep reading and writing
     private notes about those people through a direct action call. The `(app)` layout
     refuses them, but **an action isn't reached through the layout.** Same choice as
     `canGiveFeedback`, and deliberately *unlike* `canEditStaff` /
     `canViewCompensation` / `canEditTimesheet`: an **ownership** check resolves the
     caller only to compare against their own row, whereas a **relationship** check uses
     the caller's identity to reach *other people's* data, where `isActive` is part of
     "are you still one of us".
2. **The subject gets `isSubject`, and nothing else** — `SHARED` notes only, never
   drafts, never a management affordance. **The self branch returns before
   `managerId` is even read.** That is a stronger form of ADR 0047 §4's
   self-exclusion: a self-pointing `managerId` (reachable through a bad CSV — see
   below) can't make someone their own note-manager and hand them their own drafts.
3. **Two `ActionAuthorize` hooks are the real boundary**, declared in action
   metadata and enforced before every body ([ADR 0004](./0004-action-layer.md) /
   [permissions.md](../domains/permissions.md)):
   - `authorizeReviewNoteCreate` gates on `clientInput.staffId` (who the note is
     about);
   - `authorizeReviewNoteMutate` gates on `clientInput.noteId`, resolving the
     subject **and** the author server-side — the client never says who a note is
     about. A **missing** note denies with the *same* message as a forbidden one, so
     the hook can't be used to probe which ids exist.
4. **The author path — it survives a team change, not a departure.**
   `authorizeReviewNoteMutate` also allows whoever *wrote* a note to fix or delete it
   after they stop being that person's manager. Without it, a manager who changes teams
   strands their own words: unreachable to correct, unreachable to retract.
   `getStaffReviewNotes` mirrors it — a caller who is neither manager nor subject sees
   **only their own authored rows**.

   **But it is bounded by §1's active-staff requirement, not exempt from it.** The hook
   calls `getReviewNoteAccess` **first**, returns on `canManage`, and only then applies
   the author path as **`callerStaffId !== null && note.authorUserId === user.id`** — and
   because the access read resolves `callerStaffId` with `activeOnly`, that single
   condition is the author path *and* the still-employed check. The read has the matching
   early `return null` when a non-manager, non-subject caller has no active staff row.
   **"Changed teams" and "left the company" are different things:** this path was never
   meant to let someone who has left reach back in and **delete** the record of a review
   conversation, and termination here is a CSV import flipping `isActive`, which does
   **not** revoke their session.

   **The key mismatch is worth remembering, because it is what hid the gap:** a note's
   author is a **`user.id`**, while the employment check is keyed on the **staff row**. An
   early `return` on `authorUserId === user.id` therefore read as complete while skipping
   the employment check altogether. **The rule is now uniform: apart from `admin`, every
   review-note path requires an active linked staff row.**
5. **Sharing is one-way; there is no un-share.** A note is born `DRAFT` (visible to
   its author/manager and admins), and `shareReviewNote` flips it to `SHARED` once.
   Once shared, the person may already have read it, so "un-sharing" would hide it
   from them while pretending it never happened. **Deleting is the retraction path**,
   and deletion is deliberately allowed in both states for exactly that reason.
   `status` is absent from every input schema, so the lifecycle can't be skipped by
   posting a status.
6. **Editing is allowed after sharing.** A shared note can be corrected, and the
   panel marks it "edited" when `updatedAt > createdAt` so the change isn't silent.
   `status` / `staffId` / `authorUserId` are never touched by `updateReviewNote`.
7. **No new capability, so no matrix change.** `src/lib/auth/permissions.ts`, the
   matrix test, and the matrix table in [permissions.md](../domains/permissions.md)
   are **untouched** — this gate isn't expressible as a matrix row, which is the
   whole point. [ADR 0014](./0014-rbac-better-auth-access-control.md)'s lockstep rule
   isn't engaged; permissions.md instead gains a **prose** section describing the new
   kind of gate, because a reader who only reads the matrix would now be missing
   something.
8. **A note is a document, not a fact about a person** — `performance_review_note` is
   **not** effective-dated ([ADR 0007](./0007-staff-employment-effective-dating.md)
   doesn't apply), the same reasoning as `compensation_plan`
   ([ADR 0046](./0046-compensation-change-plans-rating-writing-proposals.md)).
   `noteDate` is the date of the **conversation**, not of typing.

## Consequences

- **`staff.managerId` is now load-bearing for access, not just visibility.**
  [ADR 0026](./0026-staff-manager-self-reference.md) justified keeping it a plain,
  non-effective-dated column on `staff` partly because it was display-only; ADR 0047
  narrowed that to "it scopes"; this makes it decide **reads and writes**. It is
  populated **exclusively by the staff CSV import**, has **no in-app editor**, and has
  **no cycle detection** beyond the importer's non-blocking `self` warning. So a bad
  import now changes who can read and write private review notes. The importer's
  "unresolvable or column-absent → **preserve**, only a blank cell clears" rule is the
  thing keeping that safe — **do not loosen it.** The self-guard in §2 is the
  in-app defence.
- **A gate reached by an action must re-assert what a layout would have** — and this cost
  **two** passes to get right, which is the useful part of the story. The `(app)` layout
  already refuses inactive staff, so it was tempting to lean on it; but an action is
  reachable directly and the reporting line stays stale until the next import, so leaning
  on it would have left a terminated manager reading their former reports' private notes.
  Adding `activeOnly` in §1 fixed the *manager* path — and left the **author** path, which
  short-circuited *ahead* of that check on a different key (`user.id` vs. the staff row),
  still open to a terminated author **deleting** a review record. Both are now closed, and
  the lesson generalises twice over: treat "which `ownStaffId` variant"
  as a real decision on every new action (see
  [permissions.md](../domains/permissions.md) → *Resolving the caller*), **and be
  suspicious of any early `return` that sits in front of your gate** — an exemption keyed
  on a different identity than the gate is exactly how an authorization check gets
  skipped while looking present.
- **Access follows the *current* reporting line.** There is no as-of resolution: when
  a person's manager changes, the old manager loses read access to everything except
  the notes they authored, and the new manager gains access to the whole history —
  including notes written by their predecessor. That is the intended reading of "the
  person's manager", and it is why the author path exists.
- **`authorUserId` is `onDelete: set null`, and that fails closed.** Losing the author
  row narrows access (the author path evaporates; manager/admin access remains) and
  never widens it. A null author is a legitimate state, not corruption — the seed
  produces it deliberately (see below).
- **`getStaffReviewNotes` returns `null` vs `[]`**, following ADR 0047 §5: `null`
  means "no surface at all" and the profile renders **no tab**, `[]` means "permitted,
  nothing written yet". Collapsing them would make the tab's mere presence disclose
  that notes exist about someone.
- **The profile's tab set is now viewer-dependent** (5–7 tabs). Anything keying off it
  must tolerate that — see [ADR 0050](./0050-profile-peer-feedback-tab.md), which
  lands the second such tab.
- **The seed's notes mostly have a null `authorUserId`**, because `seedStaff` links a
  `user` account to exactly one staff row (the admin). That models the `set null`
  state: readable through the reporting line, no author name, no author path. Don't
  "fix" it by inventing user accounts for everyone.
- **This is a precedent, and it should stay a narrow one.** The next thing that wants
  relationship-based access should reuse `reviewNoteAccess.ts`'s shape (one module,
  one decision function, hooks in metadata) — not scatter `managerId` comparisons
  through action bodies. If a *second* domain needs it, that's worth its own ADR
  about whether the reporting line deserves a first-class authorization abstraction.
- **"Manager" now means three things** in this codebase — the role in the matrix, the
  reporting line, and (here) the reporting line *as a gate*. Any sentence of the form
  "managers can see …" must say which.

## Alternatives considered

- **A `reviews.*` (or `notes.*`) role capability, granted to manager + admin.** The
  conventional choice, and rejected by the user directly: it would let **every**
  people manager read **every** person's private review conversation. A private
  manager↔report conversation is exactly what the reporting line expresses and a role
  cannot. It would also have been strictly *more* exposure than what shipped, while
  costing a matrix row, a test row, and a doc row.
- **Capability AND relationship** (`ratings.edit` *and* being the manager). Rejected
  as security theatre with a real cost: the relationship is already the narrower
  condition, so the capability removes no exposure — it only means a genuine manager
  who happens to hold a `user` role can't write up their own conversation, which is
  the primary use case. (Contrast the composite gate in
  [ADR 0046](./0046-compensation-change-plans-rating-writing-proposals.md), where both
  halves genuinely narrow.)
- **Keep ADR 0047's invariant and store notes on the subject's own profile as
  self-serve text.** Rejected: it's a different feature. The manager's draft — a note
  the person cannot see yet — is the core of the workflow.
- **A per-note ACL / explicit share list.** Rejected as over-built for a two-party
  document, the same reasoning ADR 0023 used against a per-field ACL for feedback. The
  audience is derivable; storing it would let it drift from the reporting line.
- **Recursive management (a skip-level can read too).** Rejected for now, matching ADR
  0047 §3's one-hop choice. Here it *would* be a security widening rather than a scope
  tweak, so it needs its own decision — not a relaxed `where` clause.
- **Un-share as the retraction path.** Rejected: the person may already have read it.
  Delete is honest about what retraction can actually achieve.
- **Effective-dating the reporting line** so access resolves as-of a note's date.
  Rejected as speculative: ADR 0026 found no as-of demand, and it would make "can I
  read this" depend on two dates. Revisit only if the reporting line starts being
  edited in-app.
