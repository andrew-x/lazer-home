# 0019 — Project ↔ Opportunity link: FK now on `opportunities`, `restrict` (many-to-one)

**Status:** accepted · 2026-07-09 · **amended 2026-07-15** (1:N → one project per opportunity) · **amended 2026-07-18** (link inverted onto `opportunities.projectId`, many opps → one project)

## Amendment (2026-07-18): the link inverted — it now lives on `opportunities.projectId`, many-to-one

**The FK moved sides and the cardinality flipped.** The link no longer lives on
`projects.opportunityId` (removed, along with its partial unique index
`projects_opportunity_idx`). It now lives on **`opportunities.projectId`** — a nullable FK
→ `projects` with **`onDelete: "restrict"`**, indexed `opportunities_project_idx`
(`src/lib/db/opportunities-schema.ts`). Migration `drizzle/0002_loud_sister_grimm.sql`
(the second incremental migration on top of the squashed baseline `0000_light_shape.sql`,
after `0001_wonderful_thing.sql`'s CRM entries) adds the column + index, **backfills**
it from the old `projects.opportunity_id` (`UPDATE opportunities SET project_id FROM projects
WHERE projects.opportunity_id = opportunities.id`), then drops the old column. The two schema
files now import each other via lazy `() => Table.id` refs (ESM-safe).

This makes the relationship **many opportunities → one project** (the reverse of the
2026-07-15 "one project per opportunity"): **a project can be built up from several
opportunities** — an original deal plus later extensions / change requests — while an
opportunity still has **at most one** project (a single-valued FK, not a junction). The
partial unique index is gone precisely because uniqueness now sits naturally on the
single-valued FK column (each opportunity row holds one `projectId`); there's nothing to
make conditionally-unique.

**The same-company invariant is now server-enforced** (finally closing the gap this ADR and
[ADR 0024](./0024-opportunity-project-handoff-and-placeholder-roles.md) both deferred). The
new `associateOpportunityProject` action rejects a project whose `companyId` differs from the
opportunity's, and its picker (`searchProjects`) is company-scoped structurally. `createProject`
still creates same-company by construction (it sets the opportunity's `projectId` on a project
it just created for a locked company).

Why invert: the planner ([ADR 0031](./0031-opportunity-project-planner-and-role-status.md))
made a project a shared delivery vehicle several deals feed into, which the project-side FK
couldn't express. Reads got simpler too: `hasProject` on the board and `project` in the
drawer are now plain column reads off the opportunity, not a reverse lookup / grouped query.
Everything below describing `projects.opportunityId` is the **superseded** prior shape; read
it as history.

## Amendment (2026-07-15): tightened to one project per opportunity

The original **1:N** choice below was **reversed** — an opportunity now has **at most one**
project. Enforced at three layers:

- **DB:** a **partial unique index** on `projects.opportunityId`
  (`uniqueIndex(...).where(sql\`"opportunity_id" is not null\`)`, migration
  `drizzle/0030_white_raider.sql`), replacing the former non-unique
  `projects_opportunity_idx`. **Partial** because the column is nullable — standalone
  projects (null `opportunityId`) aren't constrained and can coexist. The predicate must
  use the **bare** column name; Postgres rejects a table-qualified reference in a
  `CREATE INDEX ... WHERE`. It also still serves as the FK lookup index.
- **Action:** `createProject` rejects a second project for the same opportunity with a
  user-safe `"This opportunity already has a project."` (reusing `opportunityHasProject`),
  so the friendly message beats the raw unique-violation.
- **UI:** the opportunity detail drawer's **Project plan** tab hides "Create project" once
  a project is linked.

Why the reversal: in practice a tracked deal here maps to a single delivery engagement, and
the opportunity detail drawer now presents a **single**-project view. Allowing many projects
added UI ambiguity (which project "is" the deal?) for a case that wasn't materialising. The
multi-phase scenario the original 1:N anticipated is better modelled later as phases/child
records under one project than as several opportunity-linked projects. The "1:1 / unique FK"
alternative rejected below is the one now adopted (with the nuance that the FK is only
*conditionally* unique, so standalone projects still work).

## Context

The spine always described a *won* Opportunity as flowing into a Project (the CRM ↔
delivery seam — see [data-model.md](../data-model.md), [domains/crm.md](../domains/crm.md)).
Until now that link was purely proposed: `projects` and `opportunities` existed but had
no reference between them, and projects were created standalone.

This ADR (when written) added the **data-level** link only — a column and FK — and left
the handoff flow proposed. **That flow is now built** ([ADR 0024](./0024-opportunity-project-handoff-and-placeholder-roles.md)):
`createProject` accepts an optional `opportunityId` and sets the column, driven from the
opportunity detail drawer and the board's delivery-stage prompt. The shape of the link
below is the settled design it realizes.

Open questions the link forced: one project per opportunity or many? Required or optional?
Which `onDelete`? Should the linked opportunity be constrained to the project's company?

## Decision

Add a nullable **`opportunityId`** column to `projects` (`src/lib/db/projects-schema.ts`),
a FK → `opportunities.id` with **`onDelete: "restrict"`**, plus index
`projects_opportunity_idx` for reverse lookups ("which projects came from this
opportunity?"). Migration `drizzle/0017_amused_corsair.sql`.

- **~~1:N (one opportunity → many projects).~~ [Amended 2026-07-15 → 1:1, see above.]**
  The link lives as a single FK column on the *project* side, so a project points at
  **at most one** opportunity. It was originally left 1:N (one opportunity → many
  projects) with no junction table; it is now **1:1** via a partial unique index on the
  FK (see the amendment). Still no junction table — this was never many-to-many.
- **Optional.** `opportunityId` is nullable: a project can still be created standalone
  (not every project originates from a tracked deal), preserving today's flow.
- **`onDelete: "restrict"`.** An opportunity with live projects can't be deleted —
  mirroring `projects.companyId` and `opportunities.companyId` ([ADR 0016](./0016-junction-table-and-shared-enum-conventions.md)).
  Deleting a source opportunity would silently sever delivery provenance, so block it.
- **Same-company invariant is NOT enforced in the DB.** Nothing guarantees a project's
  `opportunityId` belongs to the same `companyId` as the project. A FK can't express a
  cross-column constraint cheaply, and it's left as a possible future **application-level**
  check in `createProject` (see Consequences).

## Consequences

- The won → Project handoff **is now built** ([ADR 0024](./0024-opportunity-project-handoff-and-placeholder-roles.md)):
  `createProject` sets `opportunityId` when created from an opportunity, and
  `getOpportunitiesBoard` reads a `hasProject` flag off this FK to enforce the
  delivery-stage requirement. The column is still null for standalone projects.
- **A same-company mismatch is still possible.** The app-level check (chosen opportunity's
  company == project's company) was **not** added when the flow landed; the handoff prefills
  and locks the company from the opportunity in the UI, but the server doesn't verify it.
  Don't assume the invariant holds when reasoning about company-scoped reads.
- A future opportunity-delete flow must handle the `restrict` (can't blindly delete an
  opportunity that has projects), same as the company-delete flow.

## Alternatives considered

- **1:1 (a project *is* the won opportunity, or a unique FK).** Originally rejected (a
  single won deal *might* be delivered as multiple projects/phases), but **later adopted**
  — see the 2026-07-15 amendment above. The multi-phase case didn't materialise, and the
  detail drawer's single-project view made 1:N ambiguous. The realized form is a
  **conditionally** unique FK (partial index), so standalone null-FK projects aren't forced
  into artificial uniqueness.
- **Junction table (many-to-many).** Rejected: a project originating from *multiple*
  opportunities isn't a real case here; a single nullable FK column is simpler than a
  join table and its dedupe/cascade machinery.
- **Required link.** Rejected: would break standalone project creation and force a
  synthetic opportunity for internal/non-sales work.
- **`onDelete: set null` / `cascade`.** Rejected: `cascade` would destroy delivery data
  when a deal is removed; `set null` would silently lose provenance. `restrict` keeps the
  operator honest, consistent with the other company FKs.
- **DB-level same-company constraint** (composite FK / trigger). Rejected for now:
  disproportionate machinery for a link nothing populates yet; revisit as an app-level
  check when the flow is built.
