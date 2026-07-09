# 0019 — Project ↔ Opportunity link: optional 1:N FK on `projects`, `restrict`

**Status:** accepted · 2026-07-09

## Context

The spine always described a *won* Opportunity as flowing into a Project (the CRM ↔
delivery seam — see [data-model.md](../data-model.md), [domains/crm.md](../domains/crm.md)).
Until now that link was purely proposed: `projects` and `opportunities` existed but had
no reference between them, and projects were created standalone.

This change adds the **data-level** link only — a column and FK. It does *not* build the
won → Project handoff flow: nothing populates the column yet (the `createProject` action
and form are unchanged), and there's no UI. The shape of the link, though, is a settled
design choice worth recording.

Open questions the link forced: one project per opportunity or many? Required or optional?
Which `onDelete`? Should the linked opportunity be constrained to the project's company?

## Decision

Add a nullable **`opportunityId`** column to `projects` (`src/lib/db/projects-schema.ts`),
a FK → `opportunities.id` with **`onDelete: "restrict"`**, plus index
`projects_opportunity_idx` for reverse lookups ("which projects came from this
opportunity?"). Migration `drizzle/0017_amused_corsair.sql`.

- **1:N (one opportunity → many projects).** The link lives as a single FK column on the
  *project* side, so a project points at **at most one** opportunity, while one
  opportunity can spawn **many** projects (a won deal may be delivered as several
  engagements). No junction table — this isn't many-to-many.
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

- The won → Project handoff can now be built without another migration: wire the
  `createProject` action/form (and eventually a "create project from opportunity" entry
  point) to set `opportunityId`. Until then the column is always null. Reads that project
  columns explicitly (per [`.claude/rules/database.md`](../../.claude/rules/database.md))
  won't surface it until asked.
- **A same-company mismatch is currently possible.** If/when the flow lands, add an
  app-level check that the chosen opportunity's company matches the project's company
  (both actions already consume ids, so the check is a cheap lookup). Don't assume the
  invariant holds when reasoning about company-scoped reads.
- A future opportunity-delete flow must handle the `restrict` (can't blindly delete an
  opportunity that has projects), same as the company-delete flow.

## Alternatives considered

- **1:1 (a project *is* the won opportunity, or a unique FK).** Rejected: a single won
  deal is often delivered as multiple projects/phases; a unique constraint would force
  artificial splitting. 1:N is the looser, safer default.
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
