# 0030 — Timestamped notes & next steps as append logs: two concrete tables, shared kind enum, no per-entry ownership

**Status:** accepted · 2026-07-18

## Context

Contacts and opportunities needed a running record of activity: longer prose
("what happened") and short reminders ("what's planned"). Opportunities already
carried a **single scalar `nextSteps` text column** — one overwrite-in-place
field, no history, no author, no timestamp. That was too thin: a "next step"
should be a log you append to, and the same shape is wanted on contacts.

Design choices to make: one polymorphic table or one per parent; one field or a
log; who may edit an entry; and how the most-recent next step reaches the list
views (contacts table, kanban card) cheaply.

## Decision

Model both as **append-style logs of authored, timestamped free-text entries**,
one kind for prose and one for reminders.

- **Two concrete tables, not a polymorphic one** — `contact_entries`
  (`crm-schema.ts`) and `opportunity_entries` (`opportunities-schema.ts`), each
  with a **real FK to its parent** (`onDelete: cascade` — entries die with the
  parent). No polymorphic `(parentType, parentId)` column: the repo has no
  polymorphic-FK precedent, and concrete FKs keep referential integrity in the DB.
  The two tables are otherwise identical, so they share behaviour in code, not in
  the schema.
- **One shared pg enum `crm_entry_kind` = `('note', 'next_step')`** distinguishes
  the two kinds within a table (declared once in `crm-schema.ts`, imported by
  `opportunities-schema.ts`). Notes and next steps differ **only by `kind` and a
  validation length cap** — notes ≤ 5000 chars, next steps ≤ 500 — enforced in the
  shared `entries.schema.ts` (`requiredText` + a `refineEntryBody` superRefine, so
  the per-kind cap is checked once `kind` is known). Same single-source discipline
  as the other pure client-importable schema modules.
- **Author is resolved server-side, never trusted from the client** — a shared
  `resolveAuthorStaffId.ts` wraps the canonical `getCurrentStaffAccess`.
  `authorStaffId` is a **nullable** FK → `staff` (`onDelete: set null`): this is
  *attribution, not ownership*, so an entry survives the author's staff row being
  removed and is still recorded even if the signed-in user has no staff record
  (author shown as "Unknown").
- **No per-entry ownership check** — any `crm.edit` holder may add, edit, or delete
  **any** entry on any contact/opportunity (a product decision: these are shared
  team logs, not private notes). All six actions (`add/update/delete` × contact/
  opportunity) gate on `permission: { crm: ["edit"] }` and nothing more. This is
  consistent with CRM's flat, ownership-free write model — see
  [domains/permissions.md](../domains/permissions.md).
- **The scalar `opportunities.nextSteps` column is removed.** Its content migrated
  into `opportunity_entries` as the first `next_step` entry per opportunity, then
  the column was dropped. `nextSteps` is gone from `opportunityBaseFields`, the
  create/update actions and schemas, the `updateOpportunityField` discriminated
  union, and the add-opportunity form. `getOpportunity`/`getContactDetail` now
  return `notes[]` + `nextSteps[]` (newest-first `EntryView`s from the shared
  `entryViews.ts` read helper) instead.
- **The latest next step surfaces in list views via `DISTINCT ON`** — both
  `getContactsPage` (`ContactRow`) and `getOpportunitiesBoard`
  (`OpportunityBoardCard`) left-join a `SELECT DISTINCT ON (parentId) … WHERE kind
  = 'next_step' ORDER BY parentId, createdAt DESC` subquery, so the newest next
  step (body + timestamp) rides along in one query with no N+1. Rows with no next
  step still appear (left join → null).

## Consequences

- **Timestamps cross the RSC boundary as epoch millis** (matching the board-card
  convention); `EntryView.editedAt` is null unless `updatedAt > createdAt`, so the
  UI can show an "edited" marker without a separate column.
- **Two nearly-identical tables and six near-identical actions.** The duplication
  is deliberate (concrete FKs) and contained: the schema, read helper
  (`entryViews.ts`), and UI (`entry-log.tsx`, one component switched by a
  `variant` prop) are shared, so only the thin action wrappers differ.
- **The contacts list table was slimmed** to Name · Company · Role · Next steps —
  Email/Phone/Manager/LinkedIn moved off the table (still on the detail page) to
  make room for the surfaced next step. A deliberate list-vs-detail split.
- **Adding entries to another entity** (e.g. companies, projects) means another
  concrete table + a `variant` on the shared component + three thin actions — the
  pattern is set here.

## Alternatives considered

- **Keep the scalar `nextSteps` field** — rejected: no history, author, or
  timestamp, and no room for the "notes" counterpart. The log subsumes it.
- **One polymorphic `crm_entries` table** with `(parentType, parentId)` — rejected:
  loses DB-level referential integrity (no real FK / cascade), and the repo has no
  polymorphic precedent. Two concrete tables cost a little duplication for full
  integrity and simpler reads.
- **Per-entry author-only edit/delete** — rejected as over-engineered for a shared
  team CRM log; `crm.edit` already scopes who can touch the domain at all.
- **A window function / correlated subquery instead of `DISTINCT ON`** — `DISTINCT
  ON` is the simplest Postgres idiom for "newest row per group" and reads cleanly
  in Drizzle (`selectDistinctOn`).
