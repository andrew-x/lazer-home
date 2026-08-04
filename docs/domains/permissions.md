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
  linked profile never needs it — see ownership rule below.) **Two surfaces use the
  static capability with no owner path at all**, because neither is a thing you own:
  - the allocations planner's `allocationNotes` — cross-person staffing metadata,
    gated on the **static `staff.edit` capability** for both read and write
    (managers/admins only), *not* the owner-or-`staff.edit` hook the profile fields
    use — [ADR 0041](../decisions/0041-allocation-notes-on-staff.md),
    [allocations.md](./allocations.md);
  - the **profile-completeness table** (`/reporting/profile-completeness`, exported as
    `PROFILE_COMPLETENESS_ACCESS`) — a cross-person *read* of who has and hasn't
    filled their profile in. See *Reusing a capability for a new surface* below.

  Same capability, no new matrix row, in both cases.
- **`staff.viewCompensation`** — view *another* staff member's compensation (on
  their profile and in the history feed, **and their bonus payments** — the drawer's
  Bonuses tab and the feed's `BONUS` entries, since the fact a bonus was paid is itself
  comp information), **and** every bulk/aggregate comp surface: the Compensation
  dashboard (`/reporting/compensation`), including its comp-by-level table (which
  additionally needs `ratings.view`), and the Bonus dashboard
  (`/reporting/bonuses`, as `BONUS_PAYMENT_READ_ACCESS`). (Your own
  compensation — and your own bonuses — are always visible.)
- **`pto.review`** — view the aggregated PTO summary of *other* staff. (Your own
  PTO is always visible.)

These semantics are about acting on / viewing **other** people; the owner path is
always allowed without a permission.

Two write capabilities gate data entry. They are **near**-flat: `projects.edit` has no
ownership dimension at all, and `crm.edit` has exactly **one** (completing a task you were
assigned — below). Reads are
open: any signed-in user can browse companies, contacts, opportunities, and projects
— with one carve-out, `projects.viewMargin` below, because a project's cost is
derived from individual compensation.

- **`crm.edit`** — add/edit CRM companies, contacts *and* opportunities (including
  creating a company or contact inline from another CRM form).

  **The one owner path inside it — completing a task** (`src/actions/crm/canCompleteTask.ts`,
  [ADR 0065](../decisions/0065-home-personal-task-list-and-assignee-completion.md) §2). **The
  task's own assignee may always complete it; anyone else needs `crm.edit`.** Every other CRM
  write — including `createTask` / `updateTask` / `deleteTask` — is the flat capability with
  no ownership dimension whatsoever, and notes and both relationship junctions have none
  either. Three things to know before touching it:
  - **Why it exists.** `crm.edit` is held only by `sales` / `manager` / `admin`, but
    `tasks.ownerStaffId` can point at **any** staff row. The flat gate therefore made the
    home dashboard's personal task list **read-only for exactly the people whose list it
    is** — an engineer or a finance lead handed a task could not tick it off. Rewording or
    destroying a task *is* editing CRM data; closing out your own assignment is not.
  - **It is the `canEditStaff` shape, not a new one** (ADR 0014): a decision function plus an
    `ActionAuthorize` hook (`authorizeTaskDone`) in metadata, with the rule itself in the
    pure, unit-tested `taskCompletionAllowed` (`src/lib/crm/task-completion.ts`) — which
    takes the **already-evaluated** `crm.edit` answer as a boolean, so no role is
    re-interpreted outside `permissions.ts`.
  - **No capability was added and the matrix did not change.** `permissions.ts` and
    `permissions.test.ts` are untouched; this prose is the contract for the owner path. If a
    future surface wants the *same* treatment (say "the assignee may also reword it"), that
    is a new decision, not an extension of this one.
- **`projects.edit`** — add/edit projects and their staffing (**roles — which is now the *only*
  way a delivery manager is named**, since a delivery manager is a `roleType = "DELIVERY"` role and
  the `project_delivery_managers` junction is gone;
  [ADR 0069](../decisions/0069-delivery-managers-as-project-roles-and-coverage-gaps.md) **changed no
  gate** — it only deleted mutation surface that already rode this capability. ⚠️ Not to be confused
  with the **role literally named `delivery-manager`** in the matrix below). Its type-ahead
  staff/company pickers have their own `projects.edit`-gated
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
  It also covers **delivery notes** — `createProjectDeliveryNote` / `updateProjectDeliveryNote` /
  `deleteProjectDeliveryNote`, the dated write-ups carrying a project's 1–10 health rating
  (**again no matrix change**: "may correct an engagement's delivery record" has exactly the
  audience of "may re-date its roles"). Two things to know before touching them: **edit and delete
  are deliberately *not* author-only** — a delivery note is the operational record of a shared
  engagement, so any capability holder may correct it, exactly as CRM notes have no per-entry
  ownership and CRM tasks have none over *create/edit/delete* (their one owner path is
  **completion**, which has no delivery-note counterpart), and the deliberate **inverse** of
  self-evaluations below, where authorship is the point ([ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md) §3). Which
  means **`authorStaffId` is attribution only and must never become an authorization input.** And
  **the notes read is open** (`getProjectDeliveryNotes` takes no user, masks nothing), so the health
  figure and the **Low health** badge on `/projects` reach *every* viewer — unlike the
  margin-derived badges below, because health is a human delivery judgement rather than something
  computed from anyone's pay.

- **`projects.viewMargin`** — see a project's **cost and margin**: the budget summary panel
  and per-role figures on the opportunity's Project-plan tab and the project detail page, **the
  margin figure + margin-derived risk badges (and the margin *sort order*) on the `/projects`
  list**, and — since [ADR 0068](../decisions/0068-finance-report-fee-proration-and-server-side-aggregation.md)
  — **the whole `/reporting/finance` page**, via `FINANCE_REPORT_ACCESS` below. That is now
  **four surfaces on one capability**, and the finance one is portfolio-wide, so widening this row
  widens a lot. A
  **read** capability, deliberately separate from `projects.edit`, because a role's cost *is*
  an individual's compensation — a staffed role costs that person's pay ÷ 2080, so on a
  one-role project even the aggregate discloses their salary, and the open-role figure is a
  company-wide comp average. **The whole revenue side is NOT gated** — the fixed fee, each
  role's own `billRate`, and the fixed-fee hourly-value comparator that compares the two
  (ADR 0066) — because all of it is commercial, not personal, and every project read is open.
  `sales` therefore reaches a plan through `loadOpportunityPlan` (gated `crm.edit`) and sees
  revenue only; it can also set a rate on an opportunity's plan roles, which follows from the
  same reasoning rather than being an oversight.
  Masking lives **inside the reads** — `getProjectCostBasis` decides once and both plan
  readers omit `costBasis` entirely for a viewer without it, so no compensation-derived value
  is ever sent to a client that merely hides it. The **list** goes through the same door
  (`getProjectsMarginContext` → `getProjectCostBasis`): a null cost basis means every row's
  `margin` is null, no currency toggle renders, and **no margin-based flag can fire**, so a
  non-holder sees only the two **ungated** tags — "Ending soon" and "Low health" (health is a human
  delivery judgement, not compensation-derived —
  [ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md)). The list also sends **no
  per-role cost at all** — only two whole-project figures per row
  ([ADR 0057](../decisions/0057-projects-list-margin-and-derived-flags.md)). **The Finance report is
  the fourth door and the strictest:** `getFinanceReport` `requirePermission`s the same capability and
  **throws** (the route `notFound()`s above it), and **every aggregate is computed server-side** —
  precisely because a role's cost divided by its hours *is* that person's hourly pay, so shipping a
  filterable per-role projection would put the whole portfolio's pay rates in the page HTML
  ([finance.md](./finance.md#access-control),
  [ADR 0068](../decisions/0068-finance-report-fee-proration-and-server-side-aggregation.md)).
  **!! It also gates *ordering*, not just figures**
  ([ADR 0061](../decisions/0061-projects-list-as-a-sortable-table.md) §5): a margin-ranked list
  discloses which engagements are most and least profitable, and that ranking is compensation-derived
  just as the numbers are. So the same `costBasis !== null` boolean that omits the Margin column
  (header included, not blanked) also makes `?sort=margin` fall back to the default order — a
  hand-typed URL is inert. Nothing is re-derived: the gate is read once, at the page. **If you ever
  find that sort being "repaired" by costing roles purely to order them, that is the vulnerability
  — flag it.** See the
  [projects domain](projects.md) and
  [ADR 0053](../decisions/0053-project-budgets-and-margin.md).

A capability gates editing **other people's / locked** timesheets — **and, since the
utilization report, *reading* other people's logged hours**:

- **`timesheets.edit`** — edit *any* timesheet, bypassing both the owner check and
  the ±1-week edit window. A normal user may always edit their *own* timesheet while
  it's within the window (last / this / next week) with no permission; editing another
  person's timesheet, or their own outside that window, requires this capability
  (manager/admin). Enforced by the `authorizeTimesheetEdit` hook (input-dependent, so
  it can't be a static permission alone). See the
  [timesheets domain](timesheets.md).

  **It is also a read gate.** The **Utilization report** (`/reporting/utilization`) is the
  only surface where one person could see another's logged hours, and it **reuses this
  capability rather than adding one** — the set who may already edit anyone's timesheet is
  exactly the set who may already read anyone's hours. The page itself is **ungated** (its
  **Planned** basis only re-aggregates what `getAllocationsGrid` discloses to everyone, and PTO
  *type* is never selected), but the report's whole **Logged** basis sits behind the capability,
  **cohort-wide**:

  - Without `timesheets.edit`, `getUtilizationReport` **skips both timesheet queries entirely** —
    it doesn't resolve the viewer's own staff id and doesn't scope anything with a predicate,
    because there is nothing to scope. **The gate is the absence of the query.** Verified against
    the real database: zero timesheet rows fetched, every logged figure `null`.
  - **`canViewLogged: boolean` is the single signal** the client reads (it replaced
    `confirmedStaffIds`; the per-row `hasConfirmedAccess` flag and the `canSeeConfirmed` predicate
    are gone). It disables the **Logged** toggle, with the reason stated in `BasisNote` above
    the first card (the filter bar's duplicate of that line is gone).
  - Every logged figure stays **`null`, not `0`** — a partial sum shown as a total would be a lie,
    and a zero would be worse.

  **There is deliberately no own-row path.** Earlier the read scoped the queries to the viewer and
  populated their single row; a single-basis report showing one row and "restricted" everywhere
  else is worse than not offering the basis, and their own hours are already on `/timesheets`. The
  change **only tightens** disclosure ([ADR 0064](../decisions/0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md) §6).

  **No matrix row changed** by either ADR. If the audience ever needs to widen (actuals without
  edit rights), the named path is a new **`timesheets.view`** capability added in lockstep across
  `permissions.ts`, `permissions.test.ts` and this doc — **not** loosening the scope in that read.
  See [utilization.md](./utilization.md),
  [ADR 0062](../decisions/0062-utilization-report-two-series-and-timesheet-disclosure.md) and
  [ADR 0064](../decisions/0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md).

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
  `/reporting/levels` (distribution, average level, average-by-role, per-role
  subrating averages — **no compensation rendered there at all**) and the edit page's
  current levels. Manager/admin only; there is no self-view path. Its siblings
  `/reporting/compensation` and `/reporting/bonuses` are gated on
  `staff.viewCompensation` instead, while the fourth — **`/reporting/utilization` — is
  ungated**, and **`/reporting` is a redirect** (comp → levels → **utilization** as the
  fallback, so the section no longer `notFound()`s for anyone; the fifth child,
  `/reporting/profile-completeness`, needs no redirect branch because the ladder can't
  fall through past an ungated destination). The **Reporting nav parent
  is consequently ungated too**: `staff.viewCompensation` moved down onto the Compensation and
  Bonuses children, so a section is now as loose as its loosest child.
  The one **overlap** sits on the *comp* page: its **compensation-by-level** table
  needs **both** capabilities — `staff.viewCompensation` gates the page, and the
  levels input is fetched only for `ratings.view` holders (the optional
  `ratingRecords` prop), so finance sees that dashboard minus that one table. See
  [ADR 0044](../decisions/0044-performance-dashboards-split-by-permission.md).
  (The Reporting **nav parent** used to be gated on the looser
  `staff.viewCompensation`, sound only because every `ratings.view` role also holds it
  (row 5–6 below). It is **ungated** now, so that coupling is gone — but the rule it
  came from still binds: **a parent must be as loose as its loosest child**, so check
  `nav.ts` whenever a child's gate loosens.)
  **That coupling load-bears one more place:** `getRatingsSummaryData` is gated on
  `ratings.view` alone, yet its rows carry comp **amounts**
  (`RatingRecord.employment` is the full `CompensationDimensions`) — so granting
  `ratings.view` to a role *without* `staff.viewCompensation` would make that read
  (and `/reporting/levels`, which fetches it) a bulk-comp leak, even though the
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
- **`BONUS_PAYMENT_WRITE_ACCESS = { staff: ["edit", "viewCompensation"] }`**
  (`src/lib/staff/staff-bonus.ts`) — recording, editing or deleting a
  `staff_bonus_payment`: the `/people/bonus-payments` page, its three mutations, **and
  `getBonusPayments`** (that read is identity-bearing, so it carries the *write* gate).
  Same effective audience, **manager + admin**, and the same deliberate exclusion:
  finance reads bonus totals but writes no money records about individuals. Its
  read-side sibling **`BONUS_PAYMENT_READ_ACCESS = { staff: ["viewCompensation"] }`** is
  a plain single capability, spelled as a constant only so the dashboard page and
  `getBonusSummaryData` can't drift. **No matrix change.** See
  [performance.md](performance.md) → *Bonus payments*.

### Reusing a capability for a new surface — named gate constants

Most new surfaces need **no new capability**. The recurring question is "which existing
one already describes the audience?", and the answer is expressed as a **named
`PermissionCheck` constant** exported from a pure, client-importable module, so the
route, the nav entry and the read(s) all reference the *same* object and can't drift.
The composite gates above are two of these; the single-capability ones are:

- **`PROFILE_COMPLETENESS_ACCESS = { staff: ["edit"] }`**
  (`src/lib/staff/profile-completeness.ts`) — the profile-completeness table
  (`/reporting/profile-completeness`, see
  [staff-profiles.md](./staff-profiles.md#profile-completeness-reportingprofile-completeness)).
  **Chasing profile completion belongs to whoever may edit those profiles**, so it
  reuses `staff.edit` ({manager, admin}); null/unknown roles deny as always.
  Two things make that sound rather than merely convenient: the surface is
  **named per-person but discloses only whether a field is populated** — the read
  computes presence/counts in SQL and ships **no profile content** — and the gate is
  enforced **at the read** (`requirePermission`) as well as at the route, since an
  action has no layout above it. **Nav nuance (2026-08-03):** the entry moved from the
  `ratings.edit`-gated People-management parent to the **ungated Reporting** parent, so the
  sidebar finally matches this gate — before, a hypothetical `staff.edit`-only holder was
  hidden from a page they were allowed to open. No capability, matrix row or page check
  changed; `ratings.edit` and `staff.edit` have identical role rows today, so nobody's
  effective access moved ([ADR 0055](../decisions/0055-nav-dashboards-vs-people-management.md)).
- **`BONUS_PAYMENT_READ_ACCESS = { staff: ["viewCompensation"] }`** — the bonus
  dashboard, the read half of the bonus pair (its write half is the composite
  `BONUS_PAYMENT_WRITE_ACCESS`; see [performance.md](./performance.md)).
- **`FINANCE_REPORT_ACCESS = { projects: ["viewMargin"] }`**
  (`src/lib/finance/finance-report.ts`) — the **Finance report** (`/reporting/finance`, see
  [finance.md](./finance.md#access-control)). Holders: {`finance`, `delivery-manager`, `manager`,
  `admin`}. It reuses `projects.viewMargin` because those roles **already** read a project's cost and
  margin on its detail page and the margin column on `/projects`; this **re-aggregates the same
  compensation-derived disclosure across the portfolio** rather than exposing a new *kind* of fact.
  Three details make that sound rather than merely convenient:
  - **The gate is enforced in three places off one constant** — the route (`notFound()`, so it can't
    be probed), the nav item, and the read — and the read **throws** rather than masking, unlike
    `getProjectCostBasis`: with cost and margin withheld there is no useful remainder, so a masked
    variant would be a different report, not a degraded one.
  - **Cost inputs still route through `getProjectCostBasis`**, which re-derives the same decision.
    The redundant check is accepted deliberately: inlining its `staff_employment` projection would be
    the beginning of a second answer to "may this viewer see cost".
  - **Revenue alone wouldn't need the gate** (it is commercial, not personal — the standing
    asymmetry under `projects.viewMargin` above). It is gated anyway because the page's point is
    revenue **and** margin side by side, and splitting the surface in two to dodge one capability
    check would double the number of places a portfolio total is computed.

**No matrix change, so ADR 0014's lockstep rule isn't engaged** — but the *audience*
claim is only as good as the matrix row it points at. If you change a role's
`staff.edit`, you change who sees profile completeness; change `projects.viewMargin`
and you change who sees the whole portfolio's revenue and margin, not just one project's.

### The one relationship-based gate — review notes (`staff.managerId` as an authorization input)

**This is the single exception to "authorization is role capabilities" in this codebase,
and it does not appear in the matrix at all.** Read it before you conclude that the
matrix is the whole model.

> **Narrower claim than it looks — and the matrix is even less of the whole model than it
> used to be.** What is unique here is *relationship*-based access (`staff.managerId`
> deciding who may read a row). **Owner paths are not unique and are now spread across four
> domains:** staff (`canEditStaff`, `canViewCompensation`, `getStaffPto`), timesheets
> (`canEditTimesheet`), performance (self-evaluations — the widest owner path, with a
> narrower author-only write), and **since [ADR 0065](../decisions/0065-home-personal-task-list-and-assignee-completion.md)
> the CRM too** (`canCompleteTask` — the assignee may complete their own task). None of
> those five appears in the matrix either. So: "the reporting line decides" is still the
> one relationship gate; "a capability plus an owner path" is an ordinary pattern, and any
> audit that reads only the matrix rows will miss all of them.

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

### A capability *with* a full owner path — self-evaluations (reader ≠ writer)

A **fourth** gate shape, also outside the matrix, also prose-only: **staff
self-evaluations** (`staff_self_evaluation` — a person's own dated reflection
questionnaire; [ADR 0058](../decisions/0058-self-evaluations-dated-records-with-snapshotted-answers.md)).
Its distinguishing feature is that **reading and writing have different gates**, and the
owner path is the *widest* answer rather than the narrowest.

- **Read (`getStaffSelfEvaluations`): own always, anyone else needs `ratings.view`.** Self
  is checked **first**, because it decides the write affordances too — a capability holder
  on their own profile must get them. Anyone else gets **`null`** (no tab at all); `[]`
  means "permitted, nothing written yet".
- **Write (`authorizeSelfEvaluationMutate`): the author, and nobody else.** **No capability
  path and no admin override** — deliberately unlike `reviewNoteAccess`, where `admin` *is*
  a blanket override because a manager writing about someone else needs an escalation
  route. A self-evaluation is a first-person document with **no separate author column**, so
  a third party editing it would be putting words in someone's mouth, undetectably.
  `ratings.view` grants reading and nothing more; `ratings.edit` means "assign levels" and
  doesn't apply. If HR ever needs a retraction path, that's a separate audited action —
  **not a widening of this hook.** A missing record denies with the same message as a
  forbidden one, so ids can't be probed.
- **`createSelfEvaluation` is intentionally gated by nothing beyond
  `secureActionClient`'s auth** — its input carries **no target id**, the subject comes from
  `getCurrentStaffId()`, and an `authorize` hook would have no `clientInput` field to read.
  This is one of the few legitimate "no metadata gate" mutations; it is legitimate *only*
  because the target is unforgeable.
- **No matrix change.** `permissions.ts`, `permissions.test.ts` and the matrix table below
  are **untouched** — this section is the contract.

> **This reuses `ratings.view`, and that is precisely why ADR 0032 has to be defended
> explicitly.** `ratings.view` guards manager-assigned L0–L4 levels that a staffer must
> **never** see about themselves — yet here it guards data with a **full owner path**. The
> two coexist only because they guard **different things**: a self-rating is the person's
> own five-word self-assessment, chosen by them, on a different scale. **ADR 0032 is not
> weakened.** The invariants: `getStaffSelfEvaluations` **must never join `staff_rating` or
> project a level**, and the Self-evaluations tab **must never render an assigned level
> beside a self-rating**. **"Show the assigned level for comparison" is the change that
> would quietly end ADR 0032** — refuse it, or reopen 0032 on purpose.

> **A chosen asymmetry worth knowing before you reason about "who can see what about me".**
> `ratings.view` is **wider than the reporting line**, so *any* manager can read *any*
> person's self-evaluation — while that same manager's **review notes** about the same
> conversation are reporting-line-gated and therefore **narrower**. Net effect: **a
> person's own words are more widely readable than their manager's notes about them.**
> That follows from matching the Evaluations tab's gate rather than inventing a third one;
> narrowing it would need either a new capability (a matrix change) or a **second**
> relationship gate, which ADR 0049 wants to stay the only one. Recorded, not fixed.

### Resolving the caller — `ownStaffId` and the `activeOnly` decision

`src/actions/staff/ownStaffId.ts` is the **one** low-level "user → own staff id" lookup
behind every caller-identity check. It takes **`{ activeOnly }`**, and **which variant you
pass is an access-control decision — make it deliberately in every new action.**

| Pass `activeOnly: true` | Leave it off |
|---|---|
| `canGiveFeedback`, `getReviewNoteAccess`, `loadStaffProfileDrawer` | `canEditStaff`, `canViewCompensation`, `canEditTimesheet`, `getCurrentStaffId`, `authorizeSelfEvaluationMutate` / `getStaffSelfEvaluations`, **`canCompleteTask`** |
| **Relationship / eligibility** checks — the caller's identity is used to reach **other people's** data, so `isActive` is part of "are you still one of us" | **Ownership** checks — the caller is resolved only to compare against **their own** row, so a stale-active caller reaches nothing but themselves |

**The self-evaluation gates are the newest worked example of the right-hand column, and the
reasoning is worth copying verbatim:** `authorizeSelfEvaluationMutate` resolves the caller
*only* to compare against the record's own `staffId`, so a terminated-but-still-signed-in
caller reaches **nothing but themselves** — harmless, and the `(app)` layout gives them no
page to do it from anyway. Its read counterpart uses the same variant deliberately, so the
two can't disagree about who "you" are. Contrast the *relationship* gates beside it in the
same domain (`reviewNoteAccess`, `canGiveFeedback`), which use the caller's identity to
reach **other people's** data and therefore must pass `activeOnly`.

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
- **`src/actions/crm/canCompleteTask.ts`** — the **task-completion** decision point, the
  CRM's only ownership check and the newest copy of the `canEditStaff` shape
  ([ADR 0065](../decisions/0065-home-personal-task-list-and-assignee-completion.md) §2).
  - **`canCompleteTask(user, taskId): Promise<boolean>`** — the task's **assignee** may
    always complete it; anyone else needs `crm.edit`. `crm.edit` **short-circuits before the
    DB is touched**, so only a non-holder pays for the owner lookup. It resolves the caller
    from the **passed** `user`, not the ambient session (as `canEditStaff` does) — a function
    taking a `user` must answer about *that* user, or a future caller gets a silently wrong
    answer. `ownStaffId(user.id)` with **`activeOnly` off**: an ownership check, per the table
    above.
  - **`authorizeTaskDone: ActionAuthorize`** — reads `clientInput.id` (raw and pre-validation,
    so a non-string denies outright) and throws unless `canCompleteTask` passes. **`setTaskDone`
    declares it instead of `permission: { crm: ["edit"] }`**; `createTask` / `updateTask` /
    `deleteTask` keep the static capability. **Contract:** any action using this hook must take
    an `id: string` naming a task.
  - **The rule is the pure `taskCompletionAllowed`** (`src/lib/crm/task-completion.ts`,
    unit-tested): `hasCrmEdit` wins; otherwise `ownerStaffId === callerStaffId`, and **either
    being null never matches** — comparing two nulls as equal would hand every unassigned task
    to every account with no linked staff row. An **unknown task id denies** for non-holders
    (you can't own a row that isn't there); the body's `assertRowExists` owns the message.
  - **The read beside it needs no gate at all.** `getMyTasks` takes **no `staffId`** — the
    subject comes from the session, like `getMyAllocations`, so there is no cross-user id to
    authorize. Its `MyTaskView` is a **whitelist** because it is a Client Component prop on
    `/` (see [crm.md](./crm.md#the-personal-task-list-on-)).
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
- **`src/actions/performance/selfEvaluationAccess.ts`** — the **author-only-write** site
  (`authorizeSelfEvaluationMutate`, declared in the metadata of `updateSelfEvaluation` and
  `deleteSelfEvaluation`, which carry no authz in their bodies). **No capability path, no
  admin override**; `createSelfEvaluation` needs no hook at all because its input carries
  no target id. The matching read `getStaffSelfEvaluations` projects by its own decision
  (`null` = no surface at all) and additionally refuses `canManage` on a record whose
  question set has moved on — an *integrity* rule, not authorization, enforced again inside
  `updateSelfEvaluation` by re-reading the version from the DB. See *A capability with a
  full owner path* above.
- **`src/actions/staff/loadStaffProfileDrawer.ts`** — an **interactive read** (a
  `"use server"` + `secureActionClient` read, the documented exception to the
  server-only read rule, same shape as `loadOpportunityDetail`) and **the single best
  worked example of this model in the codebase: one read composing seven slice gates in
  six different shapes, none of them on the action itself.**
  - **No capability gate on the action**, matching `/staff/[id]` — browsing a colleague's
    profile is open to any staff member. Each sensitive slice gates itself instead, and
    **every one returns `null` rather than throwing**, so an unentitled viewer gets a
    smaller drawer rather than an error:

    | Slice | Gate | Kind of gate |
    |---|---|---|
    | `compensation` | `canViewCompensation(ctx.user, staffId)` | **ownership-or-capability** (own comp always; else `staff.viewCompensation`) |
    | `bonusHistory` | `getStaffBonusHistory` → the same `canViewCompensation` | **ownership-or-capability** (the *same* decision point as comp — *that a bonus was paid* is itself comp information) |
    | `pto` | `getStaffPto` self-gates | **ownership-or-capability** (`pto.review`) |
    | `feedback` | `getFeedbackAboutStaff` | **capability, with a self *tightening*** (`feedback.review`, but the recipient tier for yourself) |
    | `reviewNotes` | `getStaffReviewNotes` → `reviewNoteAccess` | **relationship** (`staff.managerId`) |
    | `evaluationHistory` | `getStaffEvaluationHistory` self-gates | **bare capability, no owner path** (`ratings.view` — a staffer never sees their own level) |
    | `selfEvaluations` | `getStaffSelfEvaluations` self-gates | **capability *with* a full owner path, and a separate narrower write gate** (`ratings.view` to read anyone's; own always; **only the author may write, no admin override**) |

    Seven gates, **six** distinct shapes, one read — and note that **the action's own
    metadata declares none of them.** That's correct here precisely because the action
    grants nothing by itself; what it returns is assembled from reads that each answer
    for their own data. Don't "simplify" this by hoisting a capability onto the action.
    The table is also the clearest statement of how **unevenly** self-access is treated
    across this app, and that unevenness is deliberate: **own comp and bonuses always
    visible**, **own feedback visible but tier-limited**, **own review notes visible once
    shared**, **own rating level never visible at all**
    ([ADR 0032](../decisions/0032-staff-rating-levels-effective-dated-manager-only.md)),
    **own self-evaluations always visible *and* the only thing here you may write**
    ([ADR 0058](../decisions/0058-self-evaluations-dated-records-with-snapshotted-answers.md)).
    Don't regularise it — each row's asymmetry is the decision. Note also the two rows that
    share `ratings.view` and must **never** be merged or cross-joined: `evaluationHistory`
    (levels, no owner path) and `selfEvaluations` (the person's own words, full owner path).
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
