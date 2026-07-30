# Permissions (RBAC)

**Status: built.** Role-based access control over the PSA platform, on Better Auth's
native access-control system (the already-enabled `admin` plugin). This is the
authorization model the other domains gate against; it closes the earlier
open-staff-edit gap (see [ADR 0014](../decisions/0014-rbac-better-auth-access-control.md))
and adds capability-based gating to the action layer.

> **Inviolable rule:** permissioning must never be weakened, bypassed, or worked
> around. If you find a gap, escalation path, or leak, **STOP and flag it as a
> vulnerability** before doing anything else. See `.claude/rules/permissions.md`
> (auto-loads when you touch auth / action / actions files) and run `/audit-rbac`.

## Single source of truth — `src/lib/auth/permissions.ts`

Everything about access control lives in **one file**: the statement (resources +
actions), the access controller, the roles, the role→permission matrix, the Zod
role schema, and the helpers. Auth wiring (`auth.ts` / `auth-client.ts`), the
action layer, the staff-edit guard, and the PTO read all enforce *through* it.
Don't re-implement role checks inline (`user.role === "manager"`) — call the
helpers.

## Permission model

Permissions are `(resource, action)` pairs. The `statement` merges Better Auth's
`defaultStatements` (the admin plugin's `user` / `session` management perms, kept
so the admin role retains its built-in capabilities) with two business resources:

- **`staff.edit`** — edit *another* staff member's profile. (Editing your *own*
  linked profile never needs it — see ownership rule below.) **One exception has no
  owner path:** the allocations planner's `allocationNotes` are cross-person staffing
  metadata gated on the **static `staff.edit` capability** for both read and write
  (managers/admins only — a person cannot edit their own), *not* the owner-or-`staff.edit`
  hook the profile fields use. Same capability, no new matrix row — see
  [ADR 0041](../decisions/0041-allocation-notes-on-staff.md) and
  [allocations.md](./allocations.md).
- **`staff.viewCompensation`** — view *another* staff member's compensation (on
  their profile and in the history feed), **and** every bulk/aggregate comp surface:
  the Compensation dashboard (`/dashboards/compensation`), including its
  comp-by-level table (which additionally needs `ratings.view`). (Your own
  compensation is always visible.)
- **`pto.review`** — view the aggregated PTO summary of *other* staff. (Your own
  PTO is always visible.)

These semantics are about acting on / viewing **other** people; the owner path is
always allowed without a permission.

Two flat write capabilities gate data entry (no ownership dimension). Reads are
open: any signed-in user can browse companies, contacts, opportunities, and projects
— with one carve-out, `projects.viewMargin` below, because a project's cost is
derived from individual compensation.

- **`crm.edit`** — add/edit CRM companies, contacts *and* opportunities (including
  creating a company or contact inline from another CRM form).
- **`projects.edit`** — add/edit projects and their staffing (delivery managers and
  roles). Its type-ahead staff/company pickers have their own `projects.edit`-gated
  search actions (`src/actions/projects/searchStaff.ts` / `searchCompanies.ts`), so a
  delivery manager can staff a project without gaining CRM write access. **Note the surface this
  capability now reaches: moving a project to a different company** (`updateProjectField`'s
  `company` variant, plus that `projects.edit`-gated `searchCompanies` picker) is a
  **`projects.edit`** capability, **not `crm.edit`** — a delivery manager can re-parent an
  engagement onto another client without any CRM write permission. That is deliberate (it is a
  delivery decision about a `projects` row, the same reasoning as `associateOpportunityProject`
  writing an `opportunities` column under `projects.edit`), and it is constrained by a
  *data-integrity* guard rather than a permission: the action refuses while a linked opportunity
  belongs to a different company. It covers **both**
  role editors — the opportunity planner's opportunity-scoped actions **and** the project
  detail page's project-scoped `updateProjectField`,
  `createProjectRoleOnProject`, `updateProjectRoleOnProject`, `deleteProjectRoleOnProject`
  (**no matrix change** — the capability already existed). What differs between the two
  surfaces is the *data-integrity* guard, not the permission: `assertRoleEditable`
  (tentative + this opportunity) vs. `assertProjectRoleEditable` (belongs to this project,
  any status). Neither is access control; see
  [ADR 0045](../decisions/0045-project-page-as-delivery-side-role-editor.md) before
  concluding the laxer one is a hole.

- **`projects.viewMargin`** — see a project's **cost and margin**: the budget summary panel
  and per-role figures on the opportunity's Project-plan tab and the project detail page, **and
  the margin figure + margin-derived risk badges on the `/projects` list**. A
  **read** capability, deliberately separate from `projects.edit`, because a role's cost *is*
  an individual's compensation — a staffed role costs that person's pay ÷ 2080, so on a
  one-role project even the aggregate discloses their salary, and the open-role figure is a
  company-wide comp average. **Revenue (the fixed fee / rate card) is NOT gated** — it is
  commercial, not personal, and every project read is open. `sales` therefore reaches a plan
  through `loadOpportunityPlan` (gated `crm.edit`) and sees revenue only.
  Masking lives **inside the reads** — `getProjectCostBasis` decides once and both plan
  readers omit `costBasis` entirely for a viewer without it, so no compensation-derived value
  is ever sent to a client that merely hides it. The **list** goes through the same door
  (`getProjectsMarginContext` → `getProjectCostBasis`): a null cost basis means every card's
  `margin` is null, no currency toggle renders, and **no margin-based flag can fire**, so a
  non-holder only ever sees "Ending soon". The list also sends **no per-role cost at all** —
  only two whole-project figures per card
  ([ADR 0056](../decisions/0056-projects-list-margin-and-derived-flags.md)). See the
  [projects domain](projects.md) and
  [ADR 0053](../decisions/0053-project-budgets-and-margin.md).

A capability gates editing **other people's / locked** timesheets:

- **`timesheets.edit`** — edit *any* timesheet, bypassing both the owner check and
  the ±1-week edit window. A normal user may always edit their *own* timesheet while
  it's within the window (last / this / next week) with no permission; editing another
  person's timesheet, or their own outside that window, requires this capability
  (manager/admin). Enforced by the `authorizeTimesheetEdit` hook (input-dependent, so
  it can't be a static permission alone). See the
  [timesheets domain](timesheets.md).

Another capability gates a **read** rather than a write (as `projects.viewMargin`
above does):

- **`feedback.review`** — view *all* peer feedback in full (the manager/admin
  oversight view). It does NOT gate *giving* feedback: any active staff member may
  leave feedback about any other active staff member (enforced by the
  `authorizeFeedbackCreate` hook, not a capability). And it is not needed to read
  feedback *about yourself* — recipients always see the limited recipient view
  (message + giver name only), and givers always see the feedback they wrote. It
  backs **three** surfaces, all on this one unchanged capability:
  - `getFeedbackDetail` (`/feedback/[id]`, any single item);
  - `getFeedbackAboutReports` (the **"Your reports"** tab, which lists items about the
    caller's **direct reports**) — **scoping, not a second gate**: the
    `staff.managerId` reporting line only narrows a set the caller could already open in
    full ([ADR 0047](../decisions/0047-feedback-reports-scoping-not-granting.md));
  - `getFeedbackAboutStaff` (the **"Peer feedback" tab** on a staff profile and in the
    plan editor's profile drawer — full content about **any one named person**). Also no
    new gate: every row is one the holder could already open by id, so it adds
    *discovery*, not access. Its **self branch is checked first**, so on your **own**
    profile you get the limited *recipient* tier even holding this capability — a
    deliberate tightening that keeps the known self-view gap (below) to `/feedback/[id]`
    ([ADR 0050](../decisions/0050-profile-peer-feedback-tab.md)).

  **Browse-all across everyone's feedback is still deferred.** "Manager" in this matrix
  is always the *role*, and **no feedback read consults the reporting graph to decide
  whether you may see something.** *Previously this doc said no permission check anywhere
  reads the reporting graph; that is no longer true of the codebase — see* **The one
  relationship-based gate** *below. It remains true of feedback, and turning the
  reporting line into an authorization input anywhere else still needs its own ADR.* See
  the [performance domain](performance.md),
  [ADR 0023](../decisions/0023-feedback-privacy-tiers.md),
  [ADR 0047](../decisions/0047-feedback-reports-scoping-not-granting.md) and
  [ADR 0050](../decisions/0050-profile-peer-feedback-tab.md).

A resource with **two actions** gates staff overall ratings (levels L0–L4), a
sensitive read/write with **no ownership dimension** — unlike compensation or
feedback, a staffer never sees their *own* rating:

- **`ratings.view`** — view staff overall levels: the **Levels dashboard** at
  `/dashboards/levels` (distribution, average level, average-by-role, per-role
  subrating averages — **no compensation rendered there at all**) and the edit page's
  current levels. Manager/admin only; there is no self-view path. Its siblings
  `/dashboards/compensation` and `/dashboards/bonuses` are gated on
  `staff.viewCompensation` instead, and **`/dashboards` is a redirect** to whichever
  of the three the viewer may see.
  The one **overlap** sits on the *comp* page: its **compensation-by-level** table
  needs **both** capabilities — `staff.viewCompensation` gates the page, and the
  levels input is fetched only for `ratings.view` holders (the optional
  `ratingRecords` prop), so finance sees that dashboard minus that one table. See
  [ADR 0044](../decisions/0044-performance-dashboards-split-by-permission.md).
  The Performance **nav parent** is gated on the looser `staff.viewCompensation`,
  which is only sound because every `ratings.view` role also holds it (row 5–6
  below) — **if that ever changes, change the parent gate in `nav.ts`.**
  **That coupling load-bears one more place:** `getRatingsSummaryData` is gated on
  `ratings.view` alone, yet its rows carry comp **amounts**
  (`RatingRecord.employment` is the full `CompensationDimensions`) — so granting
  `ratings.view` to a role *without* `staff.viewCompensation` would make that read
  (and `/dashboards/levels`, which fetches it) a bulk-comp leak, even though the
  page renders no money. See [performance.md](performance.md) → *Compensation by
  level*.
- **`ratings.edit`** — assign / change levels and save an evaluation (a new dated
  `staff_rating` row). Manager/admin only. See the [performance domain](performance.md).

### Composite gates — requiring two capabilities at once (no new matrix row)

A `PermissionCheck` naming **two resources** is a genuine **conjunction**: Better
Auth's `authorize` ANDs across resources (`connector = "AND"` in
`node_modules/better-auth/dist/plugins/access/access.mjs`), so the caller must hold
*both*. That is how a surface stricter than any single existing capability is built
**without adding a matrix row**.

- **`COMPENSATION_PLAN_ACCESS = { staff: ["viewCompensation"], ratings: ["edit"] }`**
  (`src/lib/performance/compensation-plan.ts`) — the gate on **every**
  compensation-change-plan surface: all three pages (list, editor, **plan staff**),
  the nav sub-item, and every action (three reads + six mutations).
  Effective audience: **manager + admin**; **`finance` is correctly denied**
  (it has comp but not ratings). Defined **once** as a shared constant so the actions,
  pages, and nav entry can never drift apart. **It is a request against the existing
  matrix, not new access-control logic** — `permissions.ts` remains the only place
  that lives. See [ADR 0046](../decisions/0046-compensation-change-plans-rating-writing-proposals.md).

### The one relationship-based gate — review notes (`staff.managerId` as an authorization input)

**This is the single exception to "authorization is role capabilities" in this codebase,
and it does not appear in the matrix at all.** Read it before you conclude that the
matrix is the whole model.

**Performance review notes** (`performance_review_note` — a manager's write-up of a
review conversation) are gated on the **reporting line**, not on a capability:
`src/actions/performance/reviewNoteAccess.ts` is **the only place `staff.managerId`
decides access**, and everything about the entity routes through it.

- **`getReviewNoteAccess(user, staffId)` → `{ callerStaffId, isSubject, canManage }`.**
  `canManage` = `isAdmin(user)` **OR** the caller's linked staff id equals the subject's
  **current** `staff.managerId`. **Role capabilities are not consulted at all** —
  holding `ratings.edit` or `feedback.review` grants *nothing* here. The **subject**
  gets `isSubject` only (SHARED notes, never drafts, never management), and the self path
  returns **before** `managerId` is read, so a self-pointing import row can't make
  someone their own note-manager. The caller is resolved with **`activeOnly: true`** —
  see *Resolving the caller* below, which this gate is the motivating case for.
- **The boundary is two `ActionAuthorize` hooks**, in metadata as always:
  `authorizeReviewNoteCreate` (on `clientInput.staffId`) and `authorizeReviewNoteMutate`
  (on `clientInput.noteId`, resolving subject + author server-side; a **missing note
  denies with the same message as a forbidden one**, so ids can't be probed). The mutate
  hook adds the **author path** — whoever wrote a note may fix or delete it after they
  stop being that person's manager. It is applied **after** `getReviewNoteAccess`, as
  `callerStaffId !== null && note.authorUserId === user.id`, so it **survives a team
  change but not a departure** (see *Resolving the caller* below).
- **No new capability, so no matrix change.** `permissions.ts`, `permissions.test.ts`
  and the matrix table below are **untouched** — ADR 0014's lockstep rule isn't engaged
  because there is nothing to keep in step. This prose section *is* the contract for
  this gate.
- **Why not a capability?** A `reviews.read` capability granted to `manager` would let
  **every** people manager read **every** person's private review conversation. The
  thing being protected is a two-party conversation, which the reporting line expresses
  and a role cannot. Rejected explicitly in
  [ADR 0049](../decisions/0049-review-notes-reporting-line-as-authorization-boundary.md).
- **The cost, stated plainly:** `staff.managerId` is **CSV-import-populated with no
  in-app editor** and no cycle detection beyond a non-blocking `self` warning
  ([ADR 0026](../decisions/0026-staff-manager-self-reference.md)), so a bad import now
  changes who can **read and write** review notes. The importer's
  "unresolvable/column-absent → preserve, only a blank cell clears" rule and the self-
  guard above are what keep that safe — **don't loosen either.** Access follows the
  **current** line (not effective-dated), and `authorUserId`'s `set null` **fails
  closed** (losing the author row narrows access, never widens it).
- **Keep it the exception.** Anything *else* that wants relationship-based access needs
  its own ADR (ADR 0047's rule still stands everywhere but here). If a second entity
  does need it, reuse this shape — one module, one decision function, hooks in metadata
  — never inline `managerId` comparisons in action bodies.

### Resolving the caller — `ownStaffId` and the `activeOnly` decision

`src/actions/staff/ownStaffId.ts` is the **one** low-level "user → own staff id" lookup
behind every caller-identity check. It takes **`{ activeOnly }`**, and **which variant you
pass is an access-control decision — make it deliberately in every new action.**

| Pass `activeOnly: true` | Leave it off |
|---|---|
| `canGiveFeedback`, `getReviewNoteAccess`, `loadStaffProfileDrawer` | `canEditStaff`, `canViewCompensation`, `canEditTimesheet`, `getCurrentStaffId` |
| **Relationship / eligibility** checks — the caller's identity is used to reach **other people's** data, so `isActive` is part of "are you still one of us" | **Ownership** checks — the caller is resolved only to compare against **their own** row, so a stale-active caller reaches nothing but themselves |

**Why this is load-bearing and not tidiness.** A terminated person **keeps a valid
session until it expires**, and their former reports' `staff.managerId` **still points at
them until the next CSV import** (there's no in-app editor —
[ADR 0026](../decisions/0026-staff-manager-self-reference.md)). Without `activeOnly`,
`getReviewNoteAccess` would let them go on reading *and writing* private review notes
about those people through a **direct action call**. The `(app)` layout does refuse
inactive staff — but **an action is not reached through the layout**, so *the gate has to
assert it itself*. Never let "the layout already checks that" stand in for a check inside
an action; the same reasoning is why `loadStaffProfileDrawer` and `getProjectPto` fail
closed on their own.

**Watch for early returns that sit in front of the gate.** Review notes' **author path**
(an author may fix or delete their own note after they stop being that person's manager)
is keyed on **`user.id`**, while the employment check is keyed on the **staff row** — and
while it short-circuited *ahead* of this resolution it read as complete yet skipped the
check entirely, letting a *terminated* author still **delete** the record of a review
conversation. It now runs **after** `getReviewNoteAccess` and requires
`callerStaffId !== null`, so the path **survives a team change, not a departure**. An
exemption keyed on a different identity than the gate is exactly how an authorization
check gets skipped while looking present. Apart from `admin`, **every** review-note path
now requires an active linked staff row; see
[ADR 0049](../decisions/0049-review-notes-reporting-line-as-authorization-boundary.md) §4.

### Anonymised aggregates vs. identity-bearing surfaces

Two different disciplines apply to compensation reads, and the distinction is
deliberate — don't "fix" one to match the other:

- **Aggregate dashboards are anonymised.** `getCompensationSummaryData` and
  `getRatingsSummaryData` return **identity-free** rows (dimensions + amounts, no
  id/name/email). An aggregate comp view is **bulk exposure**, so identity never
  leaves the server even for authorized viewers — the client only filters, converts,
  and aggregates. Keep any new dashboard read in this shape.
- **Compensation plans are identity-bearing by design.** A plan is inherently
  per-person and named — anonymising it is meaningless. The response is the
  **stricter combined gate** above (plus `notFound()` on all three pages, and a
  `generateMetadata` that won't leak a plan's *name* through the tab title). The
  narrower reads still minimise: the plans **list** carries no money at all, and the
  staff **roster** behind the membership page carries no compensation — only the
  editor read, scoped to one plan's members, carries figures.

## Roles → permissions (the canonical matrix — THIS IS THE CONTRACT)

Single role per user. Roles are stored in `user.role` (text). This table is the
contract; it is asserted by `src/lib/auth/permissions.test.ts` (runs in `bun run check`
via `bun test`) and audited by `/audit-rbac`. **Changing it requires changing the
`roles` map in `permissions.ts`, the test, and this table in lockstep** — that
friction is deliberate.

> **The matrix is not the *whole* model.** Three things sit outside it and are just as
> binding: **ownership** paths (own profile / own timesheet / own comp), **composite**
> gates (a `PermissionCheck` naming two resources), and the one **relationship** gate
> (review notes — `staff.managerId`). All three are documented above; none adds a column
> here.

| Role               | `staff.edit` | `staff.viewCompensation` | `pto.review` | `crm.edit` | `projects.edit` | `projects.viewMargin` | `feedback.review` | `ratings.view` | `ratings.edit` | `timesheets.edit` | Notes                                |
| ------------------ | :----------: | :----------------------: | :----------: | :--------: | :-------------: | :-------------------: | :---------------: | :------------: | :------------: | :---------------: | ------------------------------------ |
| `user`             |      –       |            –             |      –       |     –      |        –        |           –           |         –         |       –        |       –        |         –         | default role for new users           |
| `delivery-manager` |      –       |            –             |      –       |     –      |        ✓        |           ✓           |         –         |       –        |       –        |         –         | owns projects & staffing, sees margin |
| `finance`          |      –       |            ✓             |      –       |     –      |        –        |           ✓           |         –         |       –        |       –        |         –         | views staff compensation + project margin (NOT ratings) |
| `sales`            |      –       |            –             |      –       |     ✓      |        –        |           –           |         –         |       –        |       –        |         –         | CRM data entry                       |
| `manager`          |      ✓       |            ✓             |      ✓       |     ✓      |        ✓        |           ✓           |         ✓         |       ✓        |       ✓        |         ✓         | all defined business perms           |
| `admin`            |      ✓       |            ✓             |      ✓       |     ✓      |        ✓        |           ✓           |         ✓         |       ✓        |       ✓        |         ✓         | + Better Auth admin-plugin user/session perms (`...adminAc.statements`) |

`DEFAULT_ROLE = "user"`, mirrored by `admin({ defaultRole: "user" })` in `auth.ts`.
`adminRoles: ["admin"]` lists which roles may call the admin-plugin endpoints.

## Helpers — how to gate

All exported from `src/lib/auth/permissions.ts`. They are **pure and synchronous**,
driven entirely by `user.role` (no DB / network round-trip), so they're cheap to
call in action bodies and SSR reads alike.

- **`userHasPermission(user, perms): boolean`** — does this user's role grant the
  requested permission(s)? Use for conditional logic (e.g. return `null` instead of
  throwing). **Fails closed:** unknown / null roles fall back to `DEFAULT_ROLE`
  (least privilege), so a misconfigured role can never accidentally grant access.
- **`requirePermission(user, perms): void`** — asserts a permission, throwing
  `UserSafeActionError("You don't have permission to do that.")` when denied. Used
  by `secureActionClient` (for `metadata.permission`), by `metadata.authorize` hooks
  (e.g. `authorizeStaffEdit`), and in reads where denial should be an error — i.e.
  wherever authz is enforced, just not inside action bodies.
- **`isAdmin(user): boolean`** — true when the user holds the top `admin` role. The
  one place the `"admin"` literal lives for coarse role gating (e.g. `checkAuth("admin")`),
  so access-control logic stays in this module. Prefer `userHasPermission` for
  specific capabilities.
- **`isAppRole(role): role is AppRole`** — type guard narrowing an arbitrary role
  string to a known role.
- **`roleSchema`** (Zod enum of `ROLE_SLUGS`) — validate any role value before it's
  written to `user.role`. Never write an arbitrary string into that column.

`perms` is a `PermissionCheck` — a subset of the statement, e.g.
`{ staff: ["edit"] }` or `{ pto: ["review"] }`.

## Enforcement — three metadata forms on the one client (never in the body)

This builds on the [architecture authz model](../architecture.md#authorization--rbac-declared-in-action-metadata).
Authorization is **declared in action metadata**, not hand-written in action
bodies — so an unauthorized call never reaches the mutation, and an edit action
can't forget the check. There is **one** `secureActionClient`; its middleware runs
all three forms, in order, **before the body**: `checkAuth(role)` →
`requirePermission(permission)` if set → `await authorize({ user, clientInput })` if
set. The metadata schema in `src/lib/core/action.ts` carries `role`, `permission`, and
`authorize` (all optional).

1. **Coarse role.** `metadata.role` → `checkAuth` (admin-override). The blunt gate.
2. **Static capability.** `metadata.permission?: PermissionCheck` →
   `requirePermission(ctx.user, …)`. Use for capabilities that don't depend on the
   input.
   ```ts
   secureActionClient
     .metadata({ action: "review-pto", permission: { pto: ["review"] } })
     .inputSchema(...)
     .action(...)
   ```
3. **Input-dependent / ownership.** Ownership (own vs. other) can't be expressed as
   a static permission — it depends on the target id in the input. So pass an
   **`ActionAuthorize`** hook as `metadata.authorize`: a function
   `({ user, clientInput }) => void | Promise<void>` that reads the raw
   pre-validation `clientInput` and throws `UserSafeActionError` to deny. The hook is
   **generic and reusable** — it is *not* staff-specific; any action/domain supplies
   its own. `secureActionClient` awaits it before the body.
   ```ts
   secureActionClient
     .metadata({ action: "update-staff-links", authorize: authorizeStaffEdit })
     .inputSchema(updateStaffLinksSchema) // includes staffId
     .action(async ({ parsedInput }) => { /* authz already ran */ })
   ```
   **Mandatory** wherever an action takes a target id it could mutate or read across
   users — a route-level gate alone is not enough.

### Where it's applied today

- **`src/actions/staff/canEditStaff.ts`** — the staff-edit decision point
  (ADR 0014). Exports two things:
  - **`canEditStaff(user, targetStaffId): Promise<boolean>`** — the decision: a user
    may **always** edit their **own** linked staff record; editing anyone else's
    requires `staff.edit`. (Short-circuits on the permission before touching the DB;
    otherwise resolves the caller's own `staff` row by `userId` and compares.) Used
    by `staff/[id]/page.tsx` purely as a **UI affordance** — whether to render edit
    controls.
  - **`authorizeStaffEdit: ActionAuthorize`** — the gate: reads `clientInput.staffId`
    and throws unless `canEditStaff` passes (a missing/non-string `staffId` denies by
    default). `updateStaffLinks` / `updateStaffClientIntro` declare
    `metadata({ authorize: authorizeStaffEdit })` and **carry no authz call in their
    bodies** (the old `// TODO: lock down` markers are gone). The hook is the real
    boundary; the UI check is never trusted alone. **Contract:** any action using it
    must take a `staffId: string` in its input.
- **`src/actions/staff/canViewCompensation.ts`** — the comp-visibility decision
  point (mirrors `canEditStaff`). **`canViewCompensation(user, targetStaffId):
  Promise<boolean>`** — a user may **always** see their **own** compensation; seeing
  anyone else's requires `staff.viewCompensation`. Because history renders in a client
  component (the profile's tabbed panel), this gates comp both as a UI affordance (the profile comp card) *and* at
  the read: there is **no separate `COMPENSATION` category** — comp amounts ride each
  `EMPLOYMENT` entry's summary, and when the flag is false `getStaffHistory` drops
  those amounts from the summary, so salary never leaves the server for an
  unauthorized viewer.
- **`src/actions/staff/getStaffPto.ts`** — self-scoping read. Own PTO always
  visible; viewing another person's aggregated PTO requires `pto.review`, else it
  returns `null` and `ProfileView` hides the section (graceful, not an error).
  (Reads are plain server-only functions, not actions, so they call the helpers
  inline rather than via a composed client.)
- **`src/actions/allocations/getAllocationsGrid.ts`** — the (ungated, company-wide)
  allocations planner read. A **second `pto.review` enforcement site**: the planner
  shows everyone a reason-free "Away" strip, but reveals the leave **`type`** only to
  a `pto.review` holder — `canSeePtoType = userHasPermission(user, { pto: ["review"] })`,
  and the `type` field is **nulled** in the projection otherwise, so the reason never
  leaves the server. Minimal disclosure, not a loosening of the PTO gate — see
  [ADR 0038](../decisions/0038-allocations-planner-pto-disclosure.md).
- **`src/actions/projects/getProjectPto.ts`** — the project detail page's Time off tab, a
  **third `pto.review` enforcement site** with the same shape (dates + person open to all,
  `type`/`isPending` nulled otherwise). **Tightened:** it previously returned **pending**
  (unapproved) leave to everyone while forcing `isPending: false`, so an unapproved request
  read as settled. Non-reviewers now get **approved leave only**
  (`eq(staffPto.isPending, false)` in the query — matching the allocations grid); reviewers
  still see pending. It also **fails closed with no session** rather than relying on the
  `(app)` layout redirect. See [projects.md](./projects.md).
- **`src/actions/performance/` compensation plans** — the **composite-gate** site.
  All three reads (`getCompensationPlans`, `getCompensationPlan`,
  `getStaffForCompensationPlan`) call `requirePermission(user, COMPENSATION_PLAN_ACCESS)`
  and all **six** mutations declare `metadata.permission: COMPENSATION_PLAN_ACCESS`. Two
  further **input-dependent** checks live inside the write helpers rather than the
  metadata, because they are integrity rules rather than authorization:
  `requireDraftPlan` (a committed plan is immutable — every mutation re-reads status
  instead of trusting the client) and `saveCompensationPlanItem`'s assertion that the
  item **belongs to the named plan**, so an item id from another plan can't be reached
  by naming one you do have access to.
- **`src/actions/performance/reviewNoteAccess.ts`** — the **relationship-gate** site
  (`getReviewNoteAccess` + `authorizeReviewNoteCreate` / `authorizeReviewNoteMutate`);
  the four review-note mutations declare it in metadata and carry no authz in their
  bodies, and `getStaffReviewNotes` projects by the same decision (`null` = no surface
  at all). See *The one relationship-based gate* above.
- **`src/actions/staff/loadStaffProfileDrawer.ts`** — an **interactive read** (a
  `"use server"` + `secureActionClient` read, the documented exception to the
  server-only read rule, same shape as `loadOpportunityDetail`) and **the single best
  worked example of this model in the codebase: one read composing five different gates,
  none of them on the action itself.**
  - **No capability gate on the action**, matching `/staff/[id]` — browsing a colleague's
    profile is open to any staff member. Each sensitive slice gates itself instead, and
    **every one returns `null` rather than throwing**, so an unentitled viewer gets a
    smaller drawer rather than an error:

    | Slice | Gate | Kind of gate |
    |---|---|---|
    | `compensation` | `canViewCompensation(ctx.user, staffId)` | **ownership-or-capability** (own comp always; else `staff.viewCompensation`) |
    | `pto` | `getStaffPto` self-gates | **ownership-or-capability** (`pto.review`) |
    | `feedback` | `getFeedbackAboutStaff` | **capability, with a self *tightening*** (`feedback.review`, but the recipient tier for yourself) |
    | `reviewNotes` | `getStaffReviewNotes` → `reviewNoteAccess` | **relationship** (`staff.managerId`) |
    | `evaluationHistory` | `getStaffEvaluationHistory` self-gates | **bare capability, no owner path** (`ratings.view` — a staffer never sees their own level) |

    Five gates, five different shapes, one read — and note that **the action's own
    metadata declares none of them.** That's correct here precisely because the action
    grants nothing by itself; what it returns is assembled from reads that each answer
    for their own data. Don't "simplify" this by hoisting a capability onto the action.
    The table is also the clearest statement of how **unevenly** self-access is treated
    across this app, and that unevenness is deliberate: **own comp always visible**, **own
    feedback visible but tier-limited**, **own review notes visible once shared**, **own
    rating level never visible at all** ([ADR 0032](../decisions/0032-staff-rating-levels-effective-dated-manager-only.md)).
    Don't regularise it — each row's asymmetry is the decision.
  - **This table is why a new drawer host needs no new gate.** The `/staff` org chart
    (`?view=org`) opens the same drawer from a node click and adds **no permission
    surface of its own** — it reads only `getStaffDirectory`, which never touches
    `staff_rating` or comp, so `ratings.view` can't be sidestepped by rendering a chart
    instead of a profile ([ADR 0054](../decisions/0054-staff-org-chart-dom-tree.md)). Any
    *future* host is safe on the same terms — and only on those terms.
  - **`compensation` is split out of `employment` on purpose.** The employment *facets*
    (role / line of business / employment type / billable) carry no money; the amounts
    live in a separate object built **only** when the comp gate passed. `getStaffProfile`
    returns them inline, so passing its row through would have shipped salary to every
    viewer's browser.
  - **`null` means "not permitted", never "none on file".** `CompensationSection` renders
    its own *"No compensation on file."* for the genuine-absence case, so conflating the
    two would report a gate as an absence (or worse, invite someone to "fix" the gate by
    making it return an empty object). Keep the distinction in any new gated payload.
  - **The comp gate is also an *input*, which forces a sequential read.** `history` is
    fetched **after** the `Promise.all` because `getStaffHistory(staffId, canViewComp)`
    decides from it whether to fold comp amounts into employment entries — the same
    ordering `/staff/[id]` uses. A gate that changes a *later* read's projection can't be
    parallelised with it.
  - **It requires an *active linked staff row*, not merely a session**
    (`ownStaffId(ctx.user.id, { activeOnly: true })` — see *Resolving the caller* above).
    Two independent reasons: sign-in is Google but **not domain-restricted**, so a valid
    session can belong to someone who isn't staff at all; and a terminated person's
    session outlives their employment. The `(app)` layout bounces both, but an **action
    has no layout above it** and must refuse them itself. Copy this when adding an
    interactive read that mirrors a page inside `(app)`.
  - **The standing rule this read exists to demonstrate: a client-fetched payload must be
    minimised in the *projection*, never in the JSX.** A server-rendered page may hand a
    component data it chooses not to render; an action's response ships whatever it
    returns. This got *more* load-bearing when compensation was added to the drawer, not
    less — the answer was to gate the field, not to keep it out.

## Wiring

- `src/lib/auth/auth.ts`: `admin({ ac, roles, adminRoles: ["admin"], defaultRole: "user" })`.
- `src/lib/auth/auth-client.ts`: `adminClient({ ac, roles })` — so the client API
  (`authClient.admin.hasPermission` / `checkRolePermission`) stays in sync with the
  server. Note: server-side gating uses the pure helpers above, not the client API.
- **`user.role` stays a `text()` column.** Better Auth owns `auth-schema.ts`
  (regenerated by `bun run auth:generate`); a `pgEnum` there would be clobbered on
  the next generate. Validity is enforced at the app layer by `roleSchema`. (Optional
  later hardening: a DB `CHECK` constraint in a hand-written migration.)

## Assigning roles — the local-only Manage Users tool

There is a **local-only** role/ban admin: `/admin/manage-users` (in the
host-gated admin area, [ADR 0008](../decisions/0008-localhost-only-admin-area.md)).
A TanStack table lists every application user with inline-editable **role** (Select)
and **banned** (Switch) cells, client-side search + role/banned filters, a floating
save bar, and a confirm dialog showing per-user old→new diffs before committing
(mirrors the bulk-edit-roles UX). New users still get `DEFAULT_ROLE` (`user`); roles
can also be set directly in the DB or via `auth.api.setRole`.

Two things make this tool different from the other admin tools (which are
`publicActionClient` + `assertLocalhost()`):

- **Mutations go through the Better Auth admin API**, not direct column writes:
  `commitUserChanges` (`src/actions/admin/commitUserChanges.ts`) calls
  `auth.api.setRole` / `banUser` / `unbanUser`. Reason: a ban must **revoke the
  user's sessions**, which the admin API does and a raw `user.banned` write would
  not. (Deliberate contrast with `commitBulkEditEmployment`, which writes Drizzle
  directly because employment facts are plain domain data with no session side
  effect.) It re-reads current role/banned, drops no-ops, and never trusts the
  client payload; every role validates against `roleSchema` first.
- **Gated with `secureActionClient` + `metadata({ role: "admin" })`** (not
  `publicActionClient`) *plus* `assertLocalhost()`. The admin API endpoints require
  the **caller** to be an admin, so the action both forwards the caller's session
  headers and asserts the admin role. **Bootstrapping caveat:** the signed-in local
  developer must already hold `admin` to use the tool — the *first* admin must be set
  directly in the DB or via `auth.api.setRole` (chicken-and-egg). Read side:
  `getUsers` (`src/actions/admin/getUsers.ts`, server-only) returns
  `UserAdminRow[]`, narrowing role via `isAppRole` and normalizing `banned` to a
  boolean.

## Governance & guardrails

- **`.claude/rules/permissions.md`** — the inviolable rule + non-negotiables
  (every mutating/sensitive action declares a gate or a justified public marker;
  row-level checks mandatory on target ids; all DB access through the actions layer;
  default to deny; keep matrix/test/this-doc in lockstep). Path-scoped to
  auth / action / actions files.
- **`/audit-rbac`** (`.claude/commands/audit-rbac.md`) — a **read-only** audit of
  the whole RBAC system (code matrix vs. this table, ungated actions, stray `db`
  writes, missing row-level checks, auth wiring in sync). Reports and flags; never
  auto-fixes. Run it before claiming permissions work is done.
- **`src/lib/auth/permissions.test.ts`** — asserts the canonical matrix; fails `bun run
  check` if any role's permission set drifts.
- **AGENTS.md** carries a "Permissions (RBAC) — never break them" pointer.

## Out of scope (deferred)

- A *production* (non-localhost) role-management UI · multiple roles per user ·
  DB-level role enum / CHECK constraint · the aggregated-PTO-summary UI (only the
  permission + read guard are built). See
  [ADR 0014](../decisions/0014-rbac-better-auth-access-control.md). (Local
  role/ban management exists — see _Assigning roles_ above.)
