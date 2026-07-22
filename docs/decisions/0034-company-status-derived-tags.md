# 0034 — Company status as derived tags (Partner / Client / Prospect), not a stored column

**Status:** accepted · 2026-07-19

## Context

The `/companies` list needed a more useful at-a-glance signal than the old
`Website` and `Partner` columns. What a viewer actually wants to know is *what
kind of relationship* a company is: are they a partner, a paying client, a live
prospect — or several at once? The only stored relationship signal on `companies`
is the manual **`isPartner`** boolean ([ADR 0015](./0015-crm-company-over-client.md));
"client" and "prospect" are facts that already exist elsewhere in the pipeline
(confirmed projects, open opportunities) and would be redundant — and prone to
drift — if re-stored on the company.

## Decision

**A company's status is a set of *derived* tags computed from its relationships,
not a stored column. No schema change.** Three tags, in canonical order:

- **Partner** — the manual `companies.isPartner` flag (the one stored signal).
- **Client** — has at least one **confirmed** project. There is no direct
  company→project link, so it correlates through opportunities:
  `opportunities.companyId` → `opportunities.projectId`. A project no longer
  stores a status (it's derived from its roles — [ADR 0033](./0033-line-of-business-on-role-derived-project-status.md),
  `deriveProjectStatus`), so "confirmed" is expressed as *the project has ≥1
  `confirmed` role and no `tentative`/`paused` role* ("least-committed wins").
- **Prospect** — has at least one **open** opportunity, i.e. status
  `NOT IN (closed_won, closed_lost)`.

The tags are **independent** — a company can carry several (a partner who is also
a client with a live extension in the pipeline).

- **Pure shared module** `src/lib/crm/company-status.ts` (`companyStatusTags`,
  `COMPANY_STATUS_TAGS`, `COMPANY_STATUS_LABELS`) — no `db`/drizzle, no UI —
  mirrors the derived-field pattern in `project-derived.ts` so the read computing
  the flags and the UI rendering the badges share one definition of the tags,
  their order, and their labels.
- **`CLOSED_OPPORTUNITY_STATUSES`** (`closed_won`, `closed_lost`) is the single
  source of truth for terminal statuses, declared beside the status list in
  `src/lib/crm/opportunity.ts`; the prospect check negates it.
- The underlying flags are computed inline in `getCompaniesPage` as **correlated
  `EXISTS` subqueries**, so the list stays a single query. `CompanyRow` returns
  `{ id, name, isPartner, isClient, isProspect }`.
- The `/companies` list table now shows two columns — **Name** and **Status** (the
  tag badges, `EmptyCell` when none apply). `Website` moved off the list (still on
  the company detail page).

## Consequences

- **No drift, no backfill** — client/prospect are always live-derived from the
  pipeline; nothing to keep in sync, no migration.
- **Cost is a per-row pair of `EXISTS` subqueries** on the paginated page — cheap at
  this scale, and confined to one read.
- **Adding a tag is a code change, not a migration** — extend `COMPANY_STATUS_TAGS`
  + its predicate and add the backing flag to `getCompaniesPage`.

## Alternatives considered

- **A stored `status` column (or enum) on `companies`.** Rejected — client/prospect
  are already implied by confirmed projects / open opportunities; storing them
  duplicates truth and invites drift. Only `isPartner` (a genuinely manual,
  otherwise-underivable signal) stays stored.
- **A fourth "Referrer" tag** (a company that referred us work). Rejected **for now**:
  referrals are tracked **per-contact / per-staff** (the opportunity source
  junctions), not per-company, and there's no clean company→referral link. Revisit
  if a company-level referral rollup is ever modelled.
