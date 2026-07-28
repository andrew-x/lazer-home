# Project detail view: presentation fixes + make it editable

## Context

`/projects/[id]` shipped as a deliberately read-only page — its docstring says so
(`project-detail-view.tsx:52-59`), and role editing was confined to the opportunity
planner. That made sense while a project was mostly a by-product of a won deal, but the
page is now the delivery-side view of a live engagement, and four things are wrong with it:

1. **Line of business renders as `Badge` chips** (`project-detail-view.tsx:129-139`) — it's
   a derived, low-salience attribute, so chips over-weight it.
2. **Delivery managers are dead text** (`:140-144`) even though `plan.project.deliveryManagers`
   already carries `{ id, name }` — the links are free.
3. **The sidebar meta fields run together** — `MetaField` uses `gap-1` with a label the same
   size as its value, so label/value pairs don't read as distinct rows.
4. **Nothing is editable.** Neither the project's own fields nor its roles.

(4) is the substantive one. Every existing role mutation is gated by `assertRoleEditable`
(`src/actions/projects/assertRoleEditable.ts:46-55`), which requires a role to be
**tentative** *and* **tagged with the opportunity you're editing from**. A live project's
roles are `confirmed` (flipped by `confirmRolesOnWon` on deal-won), so reusing those actions
here would leave essentially nothing editable. This plan therefore adds **project-scoped**
role actions alongside the opportunity-scoped ones: the project page becomes the
delivery-side editor, the opportunity planner stays the deal-side one.

**On the security boundary — read this before touching the guard.** The RBAC gate is
`projects.edit` in both cases and does not change. `assertRoleEditable` is a *data-integrity*
invariant, not an access-control check, and the new guard does **not** weaken it — the strict
guard keeps applying to every opportunity-scoped action. There is already precedent for a
non-opportunity-scoped role write: `allocateStaffToRole` (`src/actions/allocations/allocateStaffToRole.ts:55-58`)
edits dates, hours and staffing on *confirmed* roles, keyed by `roleId` alone, gated only on
`projects.edit`.

**Accepted consequence (user-approved).** With a guard that checks only
`role.projectId === projectId`, a delivery user can edit or delete a confirmed role that came
from a won opportunity, which rewrites that opportunity's planner, and can shift the project's
derived status (`deriveProjectStatus` returns `tentative` for zero roles and "least-committed
wins" otherwise — deleting the last tentative role jumps the project tentative→confirmed).
This is a deliberate choice, mitigated with confirm-dialog copy, not a guard. Role **status**
stays system-derived; no status field in any UI.

## Decisions taken

| Question | Decision |
|---|---|
| Role edit scope | Full edit (create/update/delete), any status, project-scoped |
| Role status field in UI | No — stays system-derived |
| Sidebar field editing | Per-field inline pencils (`InlineEditField` + a project `useInlineSave`) |
| Sidebar separation | Restyle the shared primitive in `detail-parts.tsx` (3 consumers) |
| Timeline (Gantt) tab | Stays read-only — editing lives in the Roles tab |
| Company / line of business | Stay read-only (company is structural; LoB is derived, not a field) |

---

## Phase 1 — Shared sidebar primitives

**Modify `src/components/crm/detail-parts.tsx`** (consumers: company, contact and project
detail views — verify all three visually).

Two independent changes, don't conflate them: the label restyle fixes hierarchy *within* a
field; the gap bump adds separation *between* fields.

- `SidebarSection`: `gap-4` → `gap-5`, plus container-owned label styling:
  ```
  "flex flex-col gap-5 border-t pt-5 [&_[data-slot=label]]:text-xs \
   [&_[data-slot=label]]:font-medium [&_[data-slot=label]]:uppercase \
   [&_[data-slot=label]]:tracking-wide [&_[data-slot=label]]:text-muted-foreground"
  ```
  **Why container-owned and why `data-slot`:** three different components emit labels inside
  these sidebars — `MetaField`, `FormField` (via `InlineEditField`), and the bespoke
  `<Label>` in `inline-relationship-strength-field.tsx:55`. Styling via a prop would need
  threading through all three plus forwarding through `InlineEditField`, and adding a
  `variant` to `FormField` pushes a sidebar concern into the app's most-used form primitive.
  `src/components/ui/label.tsx:8-10` renders a real `<label>` with `data-slot="label"`, and
  that attribute is unique to our `Label` — so the selector can only ever hit our own
  primitive, unlike `[&_label]`. Precedent for container-owned descendant styling:
  `profile-view.tsx:245`. Verified: no `<label>` lives inside `EntityCombobox` /
  `EntityMultiCombobox` / `ui/combobox.tsx`, so edit controls are unaffected.
- `MetaField`: `gap-1` → `gap-1.5`, value box → `<div className="min-h-8 py-1 text-sm">`.
  This matches `FormField` (`form-field.tsx:38`) and `InlineEditField`
  (`inline-edit-field.tsx:78`), so read-only rows and inline-edit rows sitting side by side
  in the same sidebar finally share a vertical rhythm — today `MetaField` rows read visibly
  tighter. Keep the `<Label>` (not a `<span>`) even though it labels no control: the moment
  it stops emitting `data-slot="label"` there are two styling paths again. Note that
  tradeoff in the docstring.
- `DetailSection`: add optional `action?: ReactNode`, header row becomes
  `flex items-center justify-between gap-2` around the `<h3>` + action. Mirror `TabSection`
  (`profile-view.tsx:68-70`). Optional prop ⇒ all 11 existing call sites unchanged.

Do **not** add per-field hairline dividers: `SidebarSection` already uses `border-t` for
section boundaries, and per-field rules would make the two levels indistinguishable.

## Phase 2 — Revalidation helper

**New `src/actions/projects/revalidate.ts`** — `revalidateProject(projectId)` revalidating
`/projects`, `` `/projects/${projectId}` ``, `/opportunities`, **and `/allocations`** (project
roles are the allocations grid's data source — `allocateStaffToRole.ts:60-62` revalidates the
same set for exactly this reason). Docstring mirrors `src/actions/crm/revalidate.ts:4-7`.

**Modify `src/actions/projects/updateProject.ts:50-52`** to use it — it currently misses the
detail route and `/allocations` entirely. Every action added below uses it too.

## Phase 3 — Sidebar & table presentation

**Modify `src/components/projects/detail/project-detail-view.tsx`:**

- **Line of business** (`:129-139`): drop the `Badge` map for
  `project.linesOfBusiness.map((lob) => LINE_OF_BUSINESS_LABELS[lob]).join(", ")`. Keep the
  `Badge` import — `PtoTable` still uses it (`:293`). Add a code comment that LoB is derived
  from roles, which is *why* there's no pencil; don't add sidebar microcopy saying so.
- **Delivery managers** (`:140-144`): render one `InternalLink href={`/staff/${m.id}`}` per
  manager, comma-separated. **Leave `deliveryManagerLabel` (`src/lib/projects/plan-summary.ts:53-57`)
  untouched** — it returns a `string` and is still consumed as a `StatCard` value at
  `opportunity-project-plan.tsx:440-442`, so changing it to JSX would break that call site.
- **Roles table Staff cell** (`:216-220`): wrap `role.staffName` in
  `InternalLink href={`/staff/${role.staffId}`}` when `role.staffId` is non-null. Same
  treatment, for consistency.

## Phase 4 — Permissions plumbing

**Modify `src/app/(app)/projects/[id]/page.tsx`** — it computes no permissions today. Add
`getCurrentUser()` to the existing `Promise.all` (`:23-26`) and
`const canEdit = user ? userHasPermission(user, { projects: ["edit"] }) : false`, exactly as
`src/app/(app)/projects/page.tsx:66-68` does. Pass `canEdit` to `ProjectDetailView`.

Client gating is cosmetic — the real gate is `permission: { projects: ["edit"] }` in each
action's metadata.

## Phase 5 — Inline-editable sidebar fields

**New `src/actions/projects/updateProjectField.schema.ts`** — discriminated union on `field`,
mirroring `src/actions/crm/updateCompanyField.schema.ts:14-21`. Pure/client-importable (no
drizzle) with the header comment saying so.

```ts
z.discriminatedUnion("field", [
  z.object({ field: z.literal("name"), projectId: id, name: projectName }),
  z.object({ field: z.literal("deliveryManagers"), projectId: id, deliveryManagerIds: … }),
])
```

Extract the name rule from `updateProject.schema.ts:13` into a shared `projectName` const and
reuse it in both schemas rather than retyping it — same reason `projectRoleFields` is shared.

**New `src/actions/projects/updateProjectField.ts`** — `projects.edit`; `switch` on `field`;
the `name` case uses `.returning()` + `assertRowExists` (per `updateCompanyField.ts:30-37`);
the `deliveryManagers` case reuses `updateProject.ts:27-47`'s dedupe + clear/re-insert
set-semantics inside a transaction; then `revalidateProject(projectId)`.

Two write paths for name/delivery managers (`updateProject` from the planner dialog,
`updateProjectField` from here) is the intended shape — it's exactly the company precedent,
where `company-detail-view.tsx` mounts `EditCompanyDialog` *and* the inline fields.

**New `src/components/projects/detail/use-project-inline-save.ts`** — `use-inline-save.ts`
minus the `refresh` param and its `onSuccess: refresh`. The opportunity drawer needs an
explicit refetch because its data comes from a client-side load; this page is a Server
Component passing `plan` as a prop, so `revalidatePath` on the detail route alone refreshes
the rendered values — the documented company/contact mechanism
(`inline-owner-field.tsx:19-22`). No `router.refresh()`.

One revalidate covers everything derived: `project.status` and `project.linesOfBusiness` are
computed in the same read (`getProjectPlan.ts:140-143`), so a role change refreshes the status
badge, the LoB row, the Gantt and the stat cards together.

**New `src/components/projects/detail/project-name-field.tsx`** — follow `HeaderNameField`
(`src/components/crm/opportunity-detail/fields/header-fields.tsx:17-70`), **not** a generic
`InlineEditField`: the name is an `<h2 className="font-heading text-lg font-semibold">` beside
a `ProjectStatusBadge` (`:113-120`), and dropping in `InlineEditField` would replace the
heading with a label/value pair. Swap the `<h2>` for an `Input` in edit mode; the pencil goes
in `DetailIdentity`'s `action` slot (`detail-parts.tsx:70-71`), which the project sidebar
currently leaves empty.

**New `src/components/projects/detail/delivery-managers-field.tsx`** — `InlineEditField` +
`EntityMultiCombobox` + `searchStaff` (`src/actions/projects/searchStaff.ts`), wired like
`edit-project-dialog.tsx:73-77,105`. `display` is the linked comma-separated list; pass an
explicit muted fallback ("Unassigned"-style, per `inline-owner-field.tsx:77-79`) because
`InlineEditField` has no em-dash default the way `MetaField` does.

## Phase 6 — Project-scoped role guard + actions

**New `src/actions/projects/assertProjectRoleEditable.ts`** — local `Executor` type (the 5th
local copy; already the convention in `assertRoleEditable.ts:10` and three others — don't
extract), `assertRowExists`, then throw `UserSafeActionError` unless
`role.projectId === projectId`. Return `{ id, projectId, staffId }` so it's shape-compatible
with `assertRoleEditable.ts:57`.

The docstring must state the delivery-side vs deal-side rationale loudly, and **add a
reciprocal cross-reference to `assertRoleEditable.ts:18-26`** — otherwise a reader of the
strict guard never learns a laxer sibling exists and may mistake it for a bypass.

**Three new actions**, one per file, each `permission: { projects: ["edit"] }`, each reusing
`projectRoleFields` + `endOnOrAfterStart` from `projectRole.schema.ts`, each ending in
`revalidateProject(projectId)`. Naming follows the existing
`<verb><Entity>From/OnScope` family (`createProjectFromOpportunity`,
`removeProjectFromOpportunity`, `detachProjectFromOpportunity`):

- `createProjectRoleOnProject.{ts,schema.ts}` — `{ projectId, ...projectRoleFields }`; verify
  the project row exists; insert with `opportunityId: null` and `status: "tentative"`.
- `updateProjectRoleOnProject.{ts,schema.ts}` — `{ id, projectId, ...projectRoleFields }`;
  guard inside the transaction; **never** write `status` or `opportunityId` (server-controlled
  provenance).
- `deleteProjectRoleOnProject.{ts,schema.ts}` — `{ id, projectId }`; guard inside the
  transaction; delete.

**Delete safety — verified.** No table references `project_roles` (its only mention in
`src/lib/db/` is its own definition at `projects-schema.ts:94`), so the delete can't fail on an
inbound FK or orphan child rows. Time is logged against `projects`, not roles
(`timeEntries.projectId → projects.id`, `onDelete: "restrict"`, `timesheets-schema.ts:84`), so
deleting a role never touches logged time. The residual oddity — deleting the last role leaves
logged hours on a project with no staffing line — is confirm-copy territory, not a guard.

## Phase 7 — Role dialog + table affordances

**New `src/components/projects/role-fields.tsx`** — extract `RoleFormValues` +
`ROLE_ISSUE_FIELDS` (`role-dialog.tsx:36-56`) and the ~124-line field block (`:164-287`).
Lives in the parent `projects/` folder, not `opportunity-plan/`, since two folders consume it.
This follows the repo's shared-fields convention (`company-fields.tsx`, `contact-fields.tsx`,
`opportunity-form-fields.tsx`) and restores symmetry: `projectRoleFields` is *already* shared
server-side precisely so the field rules can't drift, so leaving the client halves duplicated
would be asymmetric. **Modify `src/components/projects/opportunity-plan/role-dialog.tsx`** to
consume it — both dialogs drop to ~150 lines of wiring.

**New `src/components/projects/detail/project-role-dialog.tsx`** — `FormDialog` + `useForm` +
`RoleFields` + the three new actions, serving both add and edit off an
`existing: PlanRole | null` prop (same shape as `role-dialog.tsx`). Specifics:

- **Default line of business:** `role-dialog.tsx` takes it from the opportunity; a standalone
  project has none, so use `project.linesOfBusiness[0]` when non-empty, else `""` (forces a
  choice).
- **Delete needs a `ConfirmDialog`** (`src/components/confirm-dialog.tsx`). `role-dialog.tsx:290-301`
  deletes with no confirmation, which is safe only because its guard restricts it to tentative
  roles — this dialog can delete confirmed roles on a live project. When
  `existing.opportunityId !== null`, extend the confirm copy: *"This role came from an
  opportunity; removing it changes that opportunity's plan too."* (`PlanRole` already carries
  `opportunityId` — `getProjectPlan.ts:80`.)
- **No status field.**
- Toast policy: error-only, mirroring `role-dialog.tsx:100-104`.

**Modify the Roles tab in `project-detail-view.tsx`:**
- `DetailSection action={canEdit ? <Button>Add role</Button> : undefined}` using the new slot.
- A trailing pencil cell per row (`IconButton`, which supplies the required tooltip +
  aria-label), gated on `canEdit`. Append a single `""` to the headers array (`:205-212`) —
  `DetailTable` keys headers by their text (`detail-parts.tsx:135-147`), so two blank headers
  would collide.

**Timeline tab stays read-only.** `PlannerRow.editable` comes from
`isEditable(role, currentOpportunityId)` (`project-planner-grid.ts:168`) and `PlannerGrid`
derives checkboxes, edit targeting and select-all entirely from it
(`planner-grid.ts:66-72`). Making the project Gantt editable means changing
`buildPlannerRows`' contract for its other consumer and touching
`opportunity-project-plan.tsx` — scope creep on a shared lib for a second, redundant edit
surface. Keep the `""` and the comment at `:70-72`, updated to say editing lives in the Roles
tab.

---

## Verification

1. `bun run check` (Biome + `tsc --noEmit` + `bun test`, incl. the RBAC matrix test) and
   `bun run build`. No matrix change is expected — `projects.edit` already exists and
   `permissions.test.ts` asserts the role→capability matrix, not an action registry.
2. `bun run dev`, then walk the app:
   - **`/projects/[id]`** — LoB is plain text; each delivery manager and each staffed role's
     name links to `/staff/[id]`; sidebar labels are small/uppercase/muted with visible air
     between fields.
   - **Inline fields** — pencil the name, save, confirm the `<h2>` updates without a manual
     reload (proves `revalidatePath` alone suffices) and that cancel restores the old value.
     Same for delivery managers; check an empty selection renders the muted fallback.
   - **Roles** — add a role (confirm the project's derived status badge and LoB row update in
     the same render); edit a **confirmed** role's dates/hours/assignee; delete a role that
     came from an opportunity and check the provenance warning appears in the confirm dialog.
   - **Cross-surface** — after each role change, confirm `/allocations` and the source
     opportunity's Project-plan tab reflect it (this is what the widened
     `revalidateProject` buys).
   - **Regression** — `/companies/[id]` and `/contacts/[id]` sidebars still look right after
     the `detail-parts.tsx` restyle (both mount `MetaField` *and* inline-edit rows, so this is
     where a label mismatch would show); the opportunity planner's own role dialog still works
     after the `RoleFields` extraction.
   - **Permissions** — sign in as a role without `projects.edit` and confirm no pencils, no
     "Add role", no row actions.
3. `/audit-rbac` — the new guard and four new actions touch the authorization surface, so
   audit before shipping and address what it finds.
4. `/code-review` on the working diff before merge.
5. Dispatch the **`librarian`** subagent afterwards. Docs that will be stale:
   - `docs/domains/projects.md` — `:468` "Everything on this page is read-only", `:228`
     `getProjectPlan` "no `editable`/`currentOpportunityId` notion", `:592` timeline
     read-only (still true, new reason), the Project-detail-page section `:459-502`, the
     role-lock statement `:97`.
   - `docs/ui.md` — `:195`/`:198` read-only claims, the `detail-parts.tsx` primitive list
     (`:156-158`), the `InlineEditField` consumer list `:178`, `:190`. Pre-existing drift to
     fix while there: `:155` says `md:w-64` / `max-w-5xl`; the code is `md:w-80` /
     `max-w-6xl` + `fullWidth` (`detail-parts.tsx:38-46`).
   - `docs/domains/permissions.md` — the four new `projects.edit` actions.
   - **A new ADR** (or an amendment) — `docs/decisions/0031-opportunity-project-planner-and-role-status.md`
     and `0024-opportunity-project-handoff-and-placeholder-roles.md` establish "confirmed roles
     are locked / role editing is opportunity-scoped". A delivery-side editor narrows those
     ADRs; that's a decision worth recording, not an implementation detail. Adjacent:
     `0033-line-of-business-on-role-derived-project-status.md`,
     `0017-project-roles-as-first-allocation-cut.md`.
