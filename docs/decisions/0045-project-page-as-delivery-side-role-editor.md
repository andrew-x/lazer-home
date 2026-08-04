# 0045 — Two role editors: deal-side (opportunity planner) vs. delivery-side (project page); "confirmed roles are locked" narrowed

**Status:** accepted · 2026-07-28 · amends [ADR 0031](./0031-opportunity-project-planner-and-role-status.md) · **self-amended the same day** — decision points 5 and 6 were reversed (the Gantt is an edit surface; the project's company is editable). Read the [Amendment](#amendment-2026-07-28-the-gantt-is-an-edit-surface-and-company-is-editable) before trusting those two points. **Partly superseded on 2026-08-04 by [ADR 0069](./0069-delivery-managers-as-project-roles-and-coverage-gaps.md)** — decision points 2 and 5's `deliveryManagers` variant no longer exists (delivery managers are derived from `DELIVERY` roles); everything else stands.

## Context

`project_roles` rows had exactly **one** editor: the opportunity drawer's planner, guarded by
`assertRoleEditable` — *tentative* **and** *tagged with this opportunity*
([ADR 0031](./0031-opportunity-project-planner-and-role-status.md)). Since roles auto-confirm when
the deal is won (`confirmRolesOnWon`), that meant **a live engagement's staffing was frozen**: the
moment work actually started, nobody could re-date a role, move its hours, or swap its assignee.
ADR 0031 even recorded this as a consequence ("there is no project-side role-edit flow").

Meanwhile `/projects/[id]` existed as a purely **read-only** view — a Gantt, a roles table and a
time-off tab — so the one surface a delivery manager naturally opens for a running project could
show the plan but not touch it. Two further asymmetries made the freeze worse:

- **A standalone project has no opportunity at all**, so its roles were unreachable by *any*
  editor once created.
- **The freeze was already not absolute.** `allocateStaffToRole` (the allocations planner's
  Allocate button, [ADR 0038](./0038-allocations-planner-pto-disclosure.md)-era) re-dates and
  staffs **confirmed** open roles keyed by `roleId` alone. So a non-opportunity-scoped role write
  predates this decision; the invariant was already surface-specific in practice.

The question was therefore not "should confirmed roles be editable?" but **"which surface owns
which invariant?"**

## Decision

**Make `/projects/[id]` the delivery-side editor of an engagement, with its own laxer
data-integrity guard, and narrow the "confirmed roles are locked" rule to the opportunity
planner.** The `projects.edit` RBAC gate is unchanged and identical on both paths.

**1. Two guards, two scopes — both data-integrity, neither access control.**

| | `assertRoleEditable` (deal-side) | `assertProjectRoleEditable` (delivery-side) |
|---|---|---|
| Surface | opportunity drawer's planner | `/projects/[id]` Roles tab |
| Keyed by | `opportunityId` | `projectId` |
| Status rule | **`tentative` only** | **any status**, incl. `confirmed` |
| Rationale | a deal drawer must not rewrite another deal's plan, and a won deal's plan is committed, not a draft | a live project's roles are `confirmed` *because* the deal was won; delivery has to re-date, re-hour and re-staff them |

Containment on the delivery side is `role.projectId === projectId`: you can only touch roles on the
project you are looking at. Both guards sit **on top of** `metadata.permission: { projects: ["edit"] }`,
enforced by `secureActionClient` before the body.

**2. New project-scoped actions** (`src/actions/projects/`, one per file + a `.schema.ts` each,
all `projects.edit`): `createProjectRoleOnProject`, `updateProjectRoleOnProject`,
`deleteProjectRoleOnProject`, and the field-scoped `updateProjectField` (a discriminated union on
`field`: ~~`name` | `deliveryManagers`~~ — **plus `company`, added by amendment B below** — mirroring
`updateCompanyField`; **the `deliveryManagers` variant was deleted by
[ADR 0069](./0069-delivery-managers-as-project-roles-and-coverage-gaps.md), so the union is
`name` | `company`**). They reuse the shared
`projectRoleFields`/`endOnOrAfterStart` validation, so the two editors validate identically.

**3. `status` and `opportunityId` stay server-controlled.** The project page never writes either.
A role created here gets `opportunityId: null` (it belongs to the engagement, not a deal) and
`status: "tentative"`; a role edited here keeps its provenance and its `confirmed` status.

**4. One revalidation helper.** `revalidateProject(projectId)` hits `/projects`,
`/projects/[id]`, `/opportunities` **and `/allocations`** (project roles *are* the allocations
grid's rows). `updateProject` was retrofitted onto it — it previously missed the detail route and
`/allocations` entirely, i.e. a pre-existing staleness bug.

**5. Sidebar edits are field-scoped, not whole-record.** Name and delivery managers each write
only their own slice, so a concurrent edit to the other isn't clobbered and a name change doesn't
rewrite the delivery-manager junction. ~~**Company stays read-only** (structural — a project can't be
reparented)~~ — **superseded by the amendment below: company is editable.** **Status / lines of
business are not fields at all** (derived from roles,
[ADR 0033](./0033-line-of-business-on-role-derived-project-status.md)).

> **Partly superseded by [ADR 0069](./0069-delivery-managers-as-project-roles-and-coverage-gaps.md).**
> Delivery managers joined status and LoB in "not a field at all": they derive from the project's
> `DELIVERY` roles, the junction is dropped, and the sidebar field is a read-only `MetaField`
> (`delivery-managers-meta.tsx`) mirroring "Line of business" — so **the sidebar has two
> inline-editable fields, name and company, not three.** The field-scoping *rationale* survives
> intact and is if anything sharper: the union's remaining two variants are genuinely different
> writes (one column vs. a re-parent carrying a data-integrity refusal and a two-company
> revalidation), which is why it stayed a union rather than collapsing. Naming a delivery manager
> is now an *edit in the Roles tab* — strictly more capable, since the assignment is dated,
> statused and priced. That also makes this page the surface that shows a **delivery-coverage
> gap**, including past ones: it's the delivery-side editor this ADR argued for, so a historical
> hole is either a data fix or a fact worth knowing.

~~**6. The Timeline (Gantt) tab stays non-editable** — editing lives in the Roles tab, so the Gantt
is a display surface, still passing `""` as the current opportunity so `buildPlannerRows` marks no
row editable.~~ **Superseded by amendment A below: the Gantt opens the same role dialog, and the
`""` sentinel is gone.**

## Amendment (2026-07-28): the Gantt *is* an edit surface, and company *is* editable

Two of the decisions above were reversed within the same day, on the same branch. Both reversals
are recorded here rather than in a new ADR because they don't change the shape of the decision —
`/projects/[id]` as *the* delivery-side editor with its own laxer guard — only how far it reaches.

**A. Roles are editable from the Timeline tab too** (reversing point 6, and the last "alternatives
considered" entry below, which rejected exactly this). Both tabs now open the same
`ProjectRoleDialog`; the Roles table keeps "Add role" in its section header.

What made it safe was **splitting one flag into two** in `src/lib/projects/project-planner-grid.ts`:

- **`PlannerRow.editable`** — may the viewer edit this role? All rows in project scope; only this
  deal's `tentative` rows in opportunity scope.
- **`PlannerRow.emphasized`** — render as "this deal's own line"? **Opportunity scope only.**

`planner-grid.tsx`'s `ownBlockClass` keys the emphasis fill off **`emphasized`**, not `editable`.
Keying it off `editable` (as it did while the two concepts were one flag) would give *every* row on
the project timeline the emphasis fill, collapsing the confirmed-vs-tentative colouring the project
legend documents into a single colour. `src/lib/projects/project-planner-grid.test.ts` pins that
regression plus both scopes (5 tests) — the module previously had none despite its docstring
claiming unit-testability.

The 4th parameter of `buildPlannerRows` changed from `currentOpportunityId: string` to the exported
discriminated union **`RoleEditability`** (`{ scope: "opportunity"; opportunityId }` |
`{ scope: "project" }`). **The old "pass `""` so nothing is editable" trick is gone** — it encoded
"no editing" as an impossible opportunity id, which is exactly the kind of sentinel that made
point 6 above look like a principled lock rather than an accident of the parameter's type.

The project timeline passes `onEditRole` only when `canEdit`, and deliberately **not**
`onAssignStaff` (that picker's action, `assignRoleStaff`, is opportunity-scoped) nor the
selection/bulk props (those bulk actions run `assertRoleEditable`, the deal-side guard). Open roles
are therefore staffed through the role dialog's staff picker here, not the inline combobox.

**B. A project can be moved to another company** (reversing point 5's read-only company).
`updateProjectField` gained a `company` variant; `project-company-field.tsx` is the picker
(`InlineEditField` + `EntityCombobox` over the `projects.edit`-gated `searchCompanies`, so a
delivery manager re-parents without CRM write access). A company is required
(`projects.companyId` is `notNull`), so confirming with an empty picker reports the requirement
client-side instead of writing.

The **data-integrity rule is the interesting part.** `associateOpportunityProject` enforces that an
opportunity and its project share a company, and **nothing re-checks that after association** — so
a naive re-parent would silently leave a linked deal pointing at a project that belongs to someone
else's client. The `company` case therefore runs in a transaction that verifies the target company
exists and **refuses with a `UserSafeActionError` naming the offending opportunity** when any
opportunity linked to this project belongs to a different company: unlink or move that opportunity
first. This makes re-parenting the **third** enforcement point of the same-company invariant
([ADR 0019](./0019-project-opportunity-link.md)), alongside `associateOpportunityProject` and the
company-scoped `searchProjects`.

It revalidates **both** the old and the new company (`revalidateCompany` from
`src/actions/crm/revalidate.ts`), because a company detail page lists the projects it owns.

**Logged time is not stranded — a claim made while designing this (that re-parenting would orphan
time entries) is simply false, so don't reintroduce it as a reason to lock the field.**
`timeEntries.projectId` references the **project**, not the company
(`src/lib/db/timesheets-schema.ts`), so hours already booked simply follow the project to its new
client. That is a **billing-attribution** consequence (past hours now read against the new client),
not an FK or restrict problem, and it is what re-parenting means.

## Consequences

Accepted deliberately, with the user's explicit sign-off:

- **A `projects.edit` holder can edit or delete a `confirmed` role from the project page.** The
  blanket statement "confirmed (won) roles are locked" is now true **only of the opportunity
  planner**. ADR 0031's consequence to the contrary is superseded by this ADR.
- **Editing a role that carries an `opportunityId` also changes that opportunity's plan.** There is
  one row, shared by both views. The delete `ConfirmDialog` says so explicitly when
  `role.opportunityId` is set; edits don't warn (they're the routine case).
- **Removing a role can shift the project's *derived* status** (and its derived lines of business)
  via `deriveProjectStatus` — e.g. deleting the last `tentative` role flips the project to
  `confirmed`. Status is a projection, so this is expected, not a bug.
- **A project can end up with logged time and no staffing line.** `timeEntries.projectId` hangs off
  the *project*, not the role, so deleting a role never touches timesheets — the confirm copy says
  logged time is kept.
- **`assertRoleEditable` must stay strict.** The existence of a laxer sibling is not licence to
  relax the opportunity-scoped path; each guard's docstring cross-references the other so a future
  session doesn't read one as a hole in the system. **This is not a permission bypass** — if you
  find yourself about to "simplify" the two guards into one, re-read both docstrings first.
- **UI ripple:** `src/components/crm/detail-parts.tsx` is now shared by company, contact *and*
  project detail views (`SidebarSection` gained container-owned label styling, `MetaField` gained
  inline-edit-matching geometry, `DetailSection` gained an `action` slot). A change there touches
  three pages. See [ui.md](../ui.md).
- **Drift risk removed:** the role form fields were extracted to
  `src/components/projects/role-fields.tsx` so the two dialogs can't diverge — the client mirror of
  the already-shared server-side `projectRoleFields`.

## Alternatives considered

- **Keep the project page read-only and let delivery edit through the originating opportunity's
  drawer.** Rejected: it fails outright for standalone projects and for projects fed by several
  deals, it forces a delivery manager into a CRM surface gated on `crm.edit` to *read*, and it
  still wouldn't allow editing a role once won.
- **Relax `assertRoleEditable` to allow confirmed roles, and use one guard everywhere.** Rejected:
  that would let one deal's drawer rewrite another deal's committed plan — precisely the leak ADR
  0031's scoping exists to prevent. The invariant differs by surface, so the guard must too.
- **Introduce a "re-open"/status-edit control (confirmed → tentative) so edits go through the
  existing tentative-only path.** Rejected: `status` is server-controlled provenance driven by the
  deal lifecycle; a manual demotion would make the derived project status and the auto-confirm-on-won
  event mutually inconsistent, and it solves an authorization question with a data mutation.
- **A separate `projects.editDelivery` capability for post-win edits.** Rejected as matrix bloat —
  the population that plans staffing is exactly the population that adjusts it
  (`delivery-manager`/`manager`/`admin`). No matrix change was needed
  ([permissions.md](../domains/permissions.md), `permissions.test.ts` untouched).
- ~~**Make the Timeline Gantt itself editable instead of the Roles table.**~~ **Rejected, then
  adopted — see amendment A above.** The stated reason for rejecting it ("the planner grid's
  interactions are built around the opportunity-scoped `editable` flag") turned out to be the thing
  to fix, not a reason to stop: `editable` was doing two jobs at once. Splitting out `emphasized`
  made the grid scope-agnostic, after which wiring `onEditRole` on the project timeline was a
  few lines. The Roles table kept its editor too — the two are the same dialog, so there was never
  a choice to make between them.
