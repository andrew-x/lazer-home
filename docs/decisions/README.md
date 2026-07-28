# Architecture Decision Records (ADRs)

Short records of decisions that shape the system — capturing the **why** and the alternatives considered, so future sessions don't relitigate settled choices or undo them unknowingly.

## Format

One file per decision, numbered: `NNNN-short-title.md`. Each has: **Status** (proposed / accepted / superseded), **Context**, **Decision**, **Consequences**. The librarian adds ADRs when a non-obvious choice is made.

## Log

| # | Title | Status |
|---|-------|--------|
| [0001](./0001-record-architecture-decisions.md) | Record architecture decisions | accepted |
| [0002](./0002-modified-nextjs.md) | The pinned Next.js is modified — verify against bundled docs | accepted |
| [0003](./0003-stack-selection.md) | Core stack selection (plain Postgres driver, not Neon's serverless driver) | accepted |
| [0004](./0004-action-layer.md) | Action layer: two-client composition + UserSafeActionError | accepted |
| [0005](./0005-ui-stack.md) | UI stack: shadcn on Base UI (base-nova), indigo light theme | accepted |
| [0006](./0006-google-only-auth-and-layout-gating.md) | Google-only auth + route-group/server-layout gating (not middleware) | accepted |
| [0007](./0007-staff-employment-effective-dating.md) | Split staff into durable identity + effective-dated employment | accepted |
| [0008](./0008-localhost-only-admin-area.md) | Localhost-only admin area, gated by env + host (not auth), outside `(app)` | accepted |
| [0009](./0009-pto-import-cancel-as-delete.md) | PTO import treats cancellations as deletes; re-syncs are destructive | accepted |
| [0010](./0010-actions-layer-owns-db-access.md) | The actions layer owns all DB access — reads are server-only `get<Thing>.ts`, not `'use server'` | accepted |
| [0011](./0011-category-agnostic-history-feed.md) | The profile history feed is a category-agnostic, server-merged timeline | accepted |
| [0013](./0013-resume-pdf-parse-not-store.md) | Résumé stored as text only; PDFs parsed server-side (unpdf), never persisted | accepted |
| [0014](./0014-rbac-better-auth-access-control.md) | RBAC on Better Auth native access control (single role, matrix-as-contract) | accepted |
| [0015](./0015-crm-company-over-client.md) | CRM org entity is "Company" (with `isPartner`), not "Client" | accepted |
| [0016](./0016-junction-table-and-shared-enum-conventions.md) | Junction-table + shared-enum conventions (first many-to-many) | accepted |
| [0017](./0017-project-roles-as-first-allocation-cut.md) | `project_roles` as the first cut of Allocation (simple rows, not effective-dated) | accepted |
| [0018](./0018-skills-inline-jsonb-catalogue.md) | Skills stored inline (jsonb) from a hardcoded catalogue, not a normalized table | accepted |
| [0019](./0019-project-opportunity-link.md) | Project ↔ Opportunity link: FK now on `opportunities.projectId`, `restrict` (amended: inverted, many opps → one project) | accepted |
| [0020](./0020-compensation-effective-dated-import-only.md) | Compensation as effective-dated facts on `staff_employment`; import-only, required (no carry-forward — under-specified rows skipped), view-gated | accepted |
| [0021](./0021-opportunity-pipeline-groups-and-fractional-ordering.md) | Opportunity pipeline: status groups in code + single global fractional ordering | accepted |
| [0022](./0022-contact-manager-self-reference.md) | Contact "managed by" self-referential FK; same-company invariant enforced app-side | accepted |
| [0023](./0023-feedback-privacy-tiers.md) | Peer feedback: privacy tiers as read-projections; giving open, review gated | accepted |
| [0024](./0024-opportunity-project-handoff-and-placeholder-roles.md) | Opportunity → Project handoff: delivery-stage project requirement + placeholder roles + role type (amended: link inverted, same-company enforced) | accepted |
| [0025](./0025-line-of-business-on-opportunity-and-project-not-role.md) | Line of business belongs to the opportunity & project, not the role; opportunities split to own schema file | superseded (project point) by 0033 |
| [0026](./0026-staff-manager-self-reference.md) | Staff "reports to": durable self-FK, import-resolved by email in two passes | accepted |
| [0027](./0027-timesheet-weekly-model-and-edit-window.md) | Timesheets: per-day weekly model, whole-week replace, ±1-week edit window | accepted |
| [0028](./0028-generic-responses-table-app-validated-question-ids.md) | Generic `responses` table keyed by (staff, question); question ids validated in app code, not a pgEnum | accepted |
| [0029](./0029-external-fx-rates-and-currency-normalization.md) | External FX rates (frankfurter.dev), USD-cross-rate conversion, never-throw fallback — first live external API call | accepted |
| [0030](./0030-crm-timestamped-entries-notes-next-steps.md) | CRM notes & next steps as append logs: two concrete tables + shared kind enum, no per-entry ownership, scalar `nextSteps` dropped | accepted (notes); next-step half superseded by [0043](./0043-tasks-entity-replaces-crm-next-steps.md) |
| [0031](./0031-opportunity-project-planner-and-role-status.md) | Opportunity project planner: role `status` (tentative → confirmed), auto-confirm on won, weekly Gantt view | accepted; amended by [0033](./0033-line-of-business-on-role-derived-project-status.md) and [0045](./0045-project-page-as-delivery-side-role-editor.md) (role lock is planner-only) |
| [0032](./0032-staff-rating-levels-effective-dated-manager-only.md) | Staff rating levels (L0–L4): effective-dated, nullable, manager/admin-only with no self-view | accepted (data model + gating); one-page/no-tabs UI half superseded by [0044](./0044-performance-dashboards-split-by-permission.md) |
| [0033](./0033-line-of-business-on-role-derived-project-status.md) | LoB moves to the role; project status & LoB derived (not stored); one-click create-from-opportunity + delete/detach | accepted |
| [0034](./0034-company-status-derived-tags.md) | Company status as derived tags (Partner / Client / Prospect), not a stored column | accepted |
| [0035](./0035-schema-modules-by-import-boundary.md) | Schema modules by import boundary: drizzle-zod server-only, hand-written `z.object` for client-imported | accepted |
| [0036](./0036-lib-organized-by-domain-subfolders.md) | `src/lib` organized by domain subfolders | accepted |
| [0037](./0037-unit-tests-removed-except-rbac-matrix.md) | Unit tests removed, except the RBAC permission-matrix test | accepted |
| [0038](./0038-allocations-planner-pto-disclosure.md) | Allocations planner: public availability, gated leave reason | accepted |
| [0039](./0039-opportunities-list-view-and-board-column-capping.md) | Opportunities list view + board column capping (URL-driven view toggle, capped Maturing/Won/Lost) | accepted |
| [0040](./0040-allocations-planner-granularity.md) | Allocations planner: selectable day/week/month granularity (nominal rate at every zoom; week prorated, month flat) | accepted |
| [0041](./0041-allocation-notes-on-staff.md) | Allocation notes on `staff`: planner-inline, gated on static `staff.edit` (no owner path) | accepted |
| [0042](./0042-per-role-subratings-app-owned-jsonb.md) | Per-role rating subratings: app-owned jsonb on `staff_rating`, co-dated with the overall level | accepted |
| [0043](./0043-tasks-entity-replaces-crm-next-steps.md) | Tasks entity replaces CRM "next steps"; `crm_entry_kind` dropped, entry logs collapse to notes-only | accepted |
| [0044](./0044-performance-dashboards-split-by-permission.md) | `/performance` split into two gated dashboards (Compensation + Performance/levels); `/performance` becomes a permission-aware redirect | accepted |
| [0045](./0045-project-page-as-delivery-side-role-editor.md) | Two role editors — deal-side (opportunity planner, tentative-only) vs. delivery-side (project page, any status); "confirmed roles are locked" narrowed to the planner | accepted; self-amended same-day — the project **Gantt** is an edit surface too (`editable` vs. `emphasized` split) and the project's **company** is editable, guarded against stranding a linked opportunity |
| [0046](./0046-compensation-change-plans-rating-writing-proposals.md) | Compensation change plans: commit writes ratings only, never `staff_employment`; snapshot + drift badge reconcile against Rippling | accepted (0020 stands) |

> **0012 is intentionally absent** (the log jumps 0011 → 0013). It was a short-lived
> ADR documenting the *open staff-edit gap pending RBAC*; it was **withdrawn** once
> [ADR 0014](./0014-rbac-better-auth-access-control.md) closed that gap, and its file
> was removed. The number is retired — don't reuse it.
