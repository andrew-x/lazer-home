# Architecture Decision Records (ADRs)

Short records of decisions that shape the system — capturing the **why** and the alternatives considered, so future sessions don't relitigate settled choices or undo them unknowingly.

## Format

One file per decision, numbered: `NNNN-short-title.md`. Each has: **Status** (proposed / accepted / superseded), **Context**, **Decision**, **Consequences**. The librarian adds ADRs when a non-obvious choice is made.

## Log

| # | Title | Status |
|---|-------|--------|
| [0001](./0001-record-architecture-decisions.md) | Record architecture decisions | accepted |
| [0002](./0002-modified-nextjs.md) | The pinned Next.js is modified — verify against bundled docs | accepted |
| [0003](./0003-stack-selection.md) | Core stack selection (plain Postgres, not Neon) | accepted |
| [0004](./0004-action-layer.md) | Action layer: two-client composition + UserSafeActionError | accepted |
| [0005](./0005-ui-stack.md) | UI stack: shadcn on Base UI (base-nova), indigo light theme | accepted |
| [0006](./0006-google-only-auth-and-layout-gating.md) | Google-only auth + route-group/server-layout gating (not middleware) | accepted |
| [0007](./0007-staff-employment-effective-dating.md) | Split staff into durable identity + effective-dated employment | accepted |
| [0008](./0008-localhost-only-admin-area.md) | Localhost-only admin area, gated by host (not auth), outside `(app)` | accepted |
| [0009](./0009-pto-import-cancel-as-delete.md) | PTO import treats cancellations as deletes; re-syncs are destructive | accepted |
| [0010](./0010-actions-layer-owns-db-access.md) | The actions layer owns all DB access — reads are server-only `get<Thing>.ts`, not `'use server'` | accepted |
| [0011](./0011-category-agnostic-history-feed.md) | The profile history feed is a category-agnostic, server-merged timeline | accepted |
| [0013](./0013-resume-pdf-parse-not-store.md) | Résumé stored as text only; PDFs parsed server-side (unpdf), never persisted | accepted |
| [0014](./0014-rbac-better-auth-access-control.md) | RBAC on Better Auth native access control (single role, matrix-as-contract) | accepted |
| [0015](./0015-crm-company-over-client.md) | CRM org entity is "Company" (with `isPartner`), not "Client" | accepted |
| [0016](./0016-junction-table-and-shared-enum-conventions.md) | Junction-table + shared-enum conventions (first many-to-many) | accepted |
| [0017](./0017-project-roles-as-first-allocation-cut.md) | `project_roles` as the first cut of Allocation (simple rows, not effective-dated) | accepted |
| [0018](./0018-skills-inline-jsonb-catalogue.md) | Skills stored inline (jsonb) from a hardcoded catalogue, not a normalized table | accepted |
