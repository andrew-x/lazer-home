# 0016 — Junction-table + shared-enum conventions (first many-to-many)

**Status:** accepted · 2026-07-06

## Context

The Opportunities feature needed several many-to-many relations — an opportunity's
related contacts, its owners, and its referral sources (split into contacts and
staff). These are the **repo's first join tables**, so the shape they take becomes
the pattern future many-to-many relations (allocations' Person↔Project, skills, etc.)
will copy. Two sub-questions arose:

1. **How to model a join row** — composite PK on the two FKs, or a surrogate id like
   every other table?
2. **The `source`/`status` enums** are needed in two places at once: a Postgres
   `pgEnum` (in the schema, which pulls in `db`/drizzle and can't be imported by
   client form code) *and* a zod `z.enum` for the form + action schema. How do we
   avoid two drifting copies?

> **Updated by [ADR 0025](./0025-line-of-business-on-opportunity-and-project-not-role.md):**
> the `opportunities` table, its four junction tables, and the `pgEnum`s now live in
> `src/lib/db/opportunities-schema.ts` (split out of `crm-schema.ts`, which keeps only
> `companies` + `contacts`). The conventions below are unchanged; only the file moved.

## Decision

**Junction tables** (`opportunity_contacts`, `opportunity_owners`,
`opportunity_source_contacts`, `opportunity_source_staff` in
`src/lib/db/opportunities-schema.ts`):

- **Surrogate `text` PK** via `generateId(prefix)` — same app-minted-CUID2 convention
  as every other table, *not* a composite PK.
- **`unique(...)` on the FK pair** for set-semantics (no duplicate links). Writers also
  dedupe input id arrays before insert (`createOpportunity`) so a repeated id can't trip
  the index.
- **`index(...)` on the non-owning FK** (the contact/staff side) for reverse lookups.
- **Both FKs `onDelete: "cascade"`** — a link row is meaningless without both endpoints.
- Read the "other side" with a **single grouped follow-up query** over the relevant
  ids (see `getOpportunitiesBoard`), never per-row — avoid N+1.

**Shared enums:** declare each value tuple **once** in a pure, client-importable module
(`src/lib/crm/opportunity.ts` — no `db`/drizzle import) and import it
into *both* the `pgEnum` and the zod schema. One source of truth, no drift.

Related: `opportunities.companyId` is a **required** FK with **`onDelete: "restrict"`**
(a company with live opportunities can't be deleted) — deliberately unlike
`contacts.companyId` (optional, `set null`), because a deal without a company is
meaningless whereas a contact without one is fine.

## Consequences

- Consistent with the rest of the schema (surrogate ids everywhere), and joins/reverse
  lookups stay indexed. The `unique` makes the relation idempotent; the cascade keeps
  orphan link rows from accumulating.
- Future many-to-many relations should follow this shape; the pattern is documented in
  [data-model.md](../data-model.md#junction-tables--the-first-many-to-many-pattern).
- The shared-enum trick means adding/renaming a `source`/`status` value is a one-line
  change that both the DB migration and the form validation pick up. Keep enum modules
  free of any server-only import so client forms can consume them.
- A future company-delete flow must handle the `restrict` — it can't blindly cascade or
  null opportunities the way it can contacts.

## Alternatives considered

- **Composite PK `(opportunityId, contactId)`** — rejected: breaks the uniform surrogate-id
  convention (ID helpers, `InferSelectModel` ergonomics), and the `unique` constraint
  already provides the set-semantics a composite PK would. A surrogate id also gives each
  link a stable handle if link-level metadata is ever added.
- **Two copies of the enum values** (one for `pgEnum`, one for zod) — rejected: guaranteed
  to drift; a single imported tuple is trivially cheap.
- **`onDelete: set null` / `cascade` on `opportunities.companyId`** — rejected: an
  opportunity must belong to a company, so `restrict` (block the delete) is correct;
  cascading would silently destroy pipeline data on a company delete.
