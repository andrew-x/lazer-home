# 0042 — Tasks entity replaces CRM "next steps"; the entry logs collapse to notes-only

**Status:** accepted · 2026-07-27 · supersedes the next-step half of [ADR 0030](./0030-crm-timestamped-entries-notes-next-steps.md)

## Context

[ADR 0030](./0030-crm-timestamped-entries-notes-next-steps.md) modelled two kinds
of CRM activity as one append log: **notes** ("what happened") and **next steps**
("what's planned"), split only by a shared `crm_entry_kind` pgEnum (`note` /
`next_step`) on the `contact_entries` / `company_entries` / `opportunity_entries`
tables. A "next step" was just a short free-text entry — no assignee, no
completion, no due sense of who owns it or whether it's been done.

That was too thin for how the team actually works: a next step is really a
**to-do** — someone should own it, and you should be able to check it off. Bolting
an owner + a done flag onto the shared entry table would have split its behaviour
by `kind` even further (only next-step rows would carry an owner/done), muddying a
table whose whole point was that the two kinds were near-identical.

## Decision

Introduce a **first-class `tasks` entity** and **remove the `next_step` kind
entirely**, leaving the entry logs as **notes-only**.

- **New `tasks` table** (`src/lib/db/tasks-schema.ts`, migration
  `drizzle/0007_numerous_dagger.sql`): `description`, `ownerStaffId` +
  `creatorStaffId` (both FK → `staff`, `onDelete: set null` — attribution, not
  ownership, like `contactEntries.authorStaffId`), `done` (boolean), a nullable
  `completedAt` stamped when `done` flips true and cleared on reopen, and timestamps.
- **Exactly one parent, concrete FKs — not polymorphic.** Three nullable parent
  FKs `companyId` / `contactId` / `opportunityId` (all `onDelete: cascade`) with a
  DB `CHECK (num_nonnulls(...) = 1)` enforcing exactly one. This follows the same
  "concrete FKs over a polymorphic `(parentType, parentId)`" reasoning ADR 0030
  used for the entry tables — referential integrity stays in the DB — but here one
  table with three FKs suffices (a task is one shape regardless of parent), where
  the entries deliberately stayed as three tables. Indexed per parent on
  `(parent, done)`, since the hot read is "open tasks for this parent".
- **The entry logs become notes-only.** The `crm_entry_kind` pgEnum and the `kind`
  column are dropped from all three `*_entries` tables; the migration **deletes
  existing `next_step` rows first** so their bodies don't resurface as notes. The
  entry indexes drop `kind` (`(parent, kind, createdAt)` → `(parent, createdAt)`).
  `entries.schema.ts` loses `crm_entry_kind` / `refineEntryBody` and keeps a single
  `NOTE_MAX_LENGTH` (5000) cap; `entryViews.ts`, `entryMutations.ts`, and
  `entry-log.tsx` all drop their `kind` handling. **Notes are otherwise unchanged
  from ADR 0030** — three concrete tables, shared plumbing, no per-entry ownership.
- **Task actions mirror the notes model** — `createTask` / `updateTask` /
  `setTaskDone` / `deleteTask` (`src/actions/crm/`), all gated **`crm.edit`, no
  per-task ownership** (any editor may touch any task, exactly like notes — so **no
  RBAC matrix change**). The **creator** is resolved server-side via
  `resolveAuthorStaffId` (never trusted from the client); the **owner defaults to
  the creator** when the composer doesn't pick someone else. Reads are the
  server-only `getTasks.ts` (`getTasksForParent` for a detail card, oldest-open
  `openTasksByParent` for a page's list/board cells).
- **Entity-scoped only — no global "My Tasks" page, no `@`-mentions.** A task
  always hangs off one CRM parent; the owner is set only through the staff picker.
  These were deliberate scope cuts, not oversights.

## Consequences

- **The "latest next step" columns become "open tasks" columns.** Where
  `getContactsPage`, `getCompanyDetail` (per-contact), and `getOpportunitiesBoard`
  once left-joined a `DISTINCT ON … WHERE kind = 'next_step'` subquery for the
  single newest next step, they now call `openTasksByParent` — **one grouped query
  per page** returning *all* incomplete tasks per parent, rendered by the shared
  `open-tasks-cell.tsx`. `latestNextStep.ts` and `contact-next-step-cell.tsx` are
  deleted.
- **A "Tasks" `DetailSection`** (the new `task-list.tsx`, modelled on `EntryLog`:
  description + owner picker composer, completion checkbox, struck-through done
  text, owner + created/completed dates, inline edit/delete) sits where next steps
  were on the contact page and opportunity drawer, and is **newly added to the
  company detail page** (companies never had a next-step section). Its owner picker
  defaults to the current user, so the drawer's `loadOpportunityDetail` now returns
  `{ detail, currentStaff }` and the new `getCurrentStaffIdentity` helper prefills it.
- **The opportunity `nextSteps` migration story from ADR 0030 stands** — that
  scalar column is still gone; this ADR only removes the *replacement* next-step
  entry kind.
- Because tasks reference `staff`, deleting a staff row **unassigns** their owned /
  created tasks (set-null) rather than deleting them — an open task survives its
  owner leaving.

## Alternatives considered

- **Keep the `next_step` entry kind, add owner + done to it** — rejected: it forces
  per-`kind` divergence onto a table whose value was that the kinds were identical,
  and leaves "done" semantics on a log built for immutable-ish history.
- **A polymorphic single-FK task table** (`parentType` + `parentId`) — rejected for
  the same reason ADR 0030 rejected it for entries: no DB-level referential
  integrity. Three concrete FKs + a `num_nonnulls = 1` CHECK keep it real.
- **A global "My Tasks" inbox** across all parents — deferred, not built; tasks are
  entity-scoped for now. The `staff` FK + per-owner indexing leave the door open.
- **Per-task ownership (only owner/creator may edit)** — rejected as over-engineered,
  same as notes: `crm.edit` already scopes who can touch the domain.
