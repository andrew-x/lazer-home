# 0025 — Line of business belongs to the opportunity & project, not the role

**Status:** accepted · 2026-07-13

## Context

[ADR 0017](./0017-project-roles-as-first-allocation-cut.md) put `lineOfBusiness`
(the shared `lineOfBusinessEnum`) on each **`project_roles`** row — every staffing
line carried its own line of business. In practice a line of business is a *practice
that bills the work* (CORE, FINTECH, COMMERCE, DESIGN, CORPORATE); an engagement
belongs to one practice, and so does the deal that produced it. Scattering it per
role let a single project's roles disagree about which practice owns the work, which
never made sense and produced no useful data.

Meanwhile the CRM pipeline had **no** line of business at all — you couldn't tell
which practice a deal belonged to until a project existed, and the opportunity →
project handoff ([ADR 0024](./0024-opportunity-project-handoff-and-placeholder-roles.md))
had nothing to carry forward.

Separately, `src/lib/db/crm-schema.ts` had grown to hold companies, contacts, the
`opportunities` table, and its four junction tables — a lot for one file.

## Decision

**1. Line of business moves up to the entities that own it.**

- **`opportunities.lineOfBusiness`** — `lineOfBusinessEnum().notNull()`, **required**.
  Written by `createOpportunity`/`updateOpportunity`, projected by `getOpportunity`,
  edited via an `EnumSelect` in the add-opportunity dialog and the detail sheet.
- **`projects.lineOfBusiness`** — `lineOfBusinessEnum().notNull()`, **required**, a
  **project-level** field (not per-role). Written by `createProject`, set via an
  `EnumSelect` in the add-project dialog.
- **`project_roles.lineOfBusiness` is dropped.** A role no longer carries one; it
  inherits the project's practice. `roleType` (discipline) stays on the role.

Line of business is now a **shared/global enum carried by three entities — staff
(`staff_employment`), opportunities, and projects** — sourced everywhere from the
one pure module `src/lib/line-of-business.ts` (same single-source pattern as the
opportunity enums, [ADR 0016](./0016-junction-table-and-shared-enum-conventions.md)).

**2. The handoff pre-fills the project's line of business from the opportunity.**
`AddProjectDialog` gained a `defaultLineOfBusiness` prop; when a project is created
from an opportunity, the form defaults to the opportunity's line of business, still
editable.

**3. Opportunities move to their own schema file.** New
`src/lib/db/opportunities-schema.ts` holds `opportunitySourceEnum`,
`opportunityStatusEnum`, the `opportunities` table, the four junction tables, and
their row types. `crm-schema.ts` keeps only `companies` + `contacts`. The new file
imports `companies`/`contacts` from `./crm-schema` and `staff`/`lineOfBusinessEnum`
from `./staff-schema`; `projects-schema.ts` imports `opportunities` from it; the
`schema.ts` barrel re-exports both. Pure file organisation — no behaviour change.

**4. A project must have at least one role.** `createProjectSchema.roles` is now
`.min(1, "Add at least one role.")` (was `.default([])`); the add-project form seeds
one empty role row so the requirement is obvious.

**Migration `drizzle/0024_harsh_diamondback.sql`** adds the two `line_of_business`
columns (backfilling existing rows to `CORE` via a temporary default, then dropping
the default so they stay NOT NULL with no default) and drops
`project_roles.line_of_business`. Generated, applied, and verified.

## Consequences

- **[ADR 0017](./0017-project-roles-as-first-allocation-cut.md) is partially
  superseded:** `project_roles` no longer carries `lineOfBusiness`. The rest of that
  ADR (roles as simple non-effective-dated rows, the FK/index conventions, nullable
  `staffId` placeholders, `roleType`) stands.
- Existing opportunities and projects were all backfilled to `CORE`; there's no edit
  UI for a *project's* line of business yet (no project edit flow exists), and an
  *opportunity's* is editable via the detail sheet.
- One deal / one engagement = one practice. If a project ever legitimately spans
  practices, this would need revisiting — deliberately not supported now.

## Alternatives considered

- **Keep line of business on the role.** Rejected: it let one project's roles
  disagree about the billing practice, and produced no signal — the practice is a
  property of the engagement, not the individual staffing line.
- **Line of business on the project only (not the opportunity).** Rejected: the
  pipeline needs to segment deals by practice *before* a project exists, and the
  handoff should carry the practice forward rather than re-ask for it.
- **Make it optional / nullable.** Rejected: every deal and engagement belongs to a
  practice; NOT NULL with a `CORE` backfill is the honest shape.
- **Leave opportunities in `crm-schema.ts`.** Rejected: the file was doing too much;
  a focused per-area file matches `staff-schema`/`projects-schema`.
</content>
</invoke>
