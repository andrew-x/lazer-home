# 0043 — Tasks entity replaces CRM "next steps"; the entry logs collapse to notes-only

**Status:** accepted · 2026-07-27 · supersedes the next-step half of [ADR 0030](./0030-crm-timestamped-entries-notes-next-steps.md) · **two scope cuts partially reversed 2026-08-03** by [ADR 0065](./0065-home-personal-task-list-and-assignee-completion.md) — read the last bullet of *Since* before trusting the gate description or the "no global inbox" line below

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
  `drizzle/0008_eminent_mandroid.sql`): `description`, `ownerStaffId` +
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
  RBAC matrix change**). **[Superseded for `setTaskDone` only](#since): the task's
  assignee may now always complete it. The other three are unchanged.** The **creator** is resolved server-side via
  `resolveAuthorStaffId` (never trusted from the client); the **owner defaults to
  the creator** when the composer doesn't pick someone else. Reads are the
  server-only `getTasks.ts` (`getTasksForParent` for a detail card, oldest-open
  `openTasksByParent` for a page's list/board cells).
- **Entity-scoped only — no global "My Tasks" page, no `@`-mentions.** A task
  always hangs off one CRM parent; the owner is set only through the staff picker.
  These were deliberate scope cuts, not oversights. **[The inbox has since been
  built](#since)** as a home-dashboard block; the *model* is still entity-scoped and
  `@`-mentions are still unbuilt.

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
  **[Since built](#since)** — through exactly that door
  ([ADR 0065](./0065-home-personal-task-list-and-assignee-completion.md)).
- **Per-task ownership (only owner/creator may edit)** — rejected as over-engineered,
  same as notes: `crm.edit` already scopes who can touch the domain. **Still the right
  call for create/update/delete; [reversed for *completion*](#since)** — `crm.edit`
  scopes the domain, but it doesn't reach the person a task was assigned to
  ([ADR 0065](./0065-home-personal-task-list-and-assignee-completion.md) §2).

## Since

- **Contact "Next steps" cells are no longer read-only.** This ADR shipped every
  list/board cell as the read-only `open-tasks-cell.tsx`; **both** contact tables — the
  contacts list and the company detail page's Contacts tab — have since been made
  **editable in place** (`contact-tasks-cell.tsx` — complete / edit / delete / add,
  through the same four task actions — `crm.edit` throughout, except completion, which now
  also allows the assignee, last bullet), because task upkeep is the main reason
  to open a contact at all. No model change: `OpenTaskSummary` just gained
  `ownerId`/`ownerName` so the cell can round-trip the owner through `updateTask`.
  `open-tasks-cell.tsx` now has **exactly one caller** — it is `ContactTasksCell`'s
  fallback for viewers without `crm.edit`, no longer a cell any page renders itself (the
  kanban card mirrors the shape inline rather than importing it). See
  [domains/crm.md](../domains/crm.md#tasks).
- **That cell's editor is a popover, and the summary row now carries the owner.** The
  first cut expanded a row into an inline `TaskFields` editor with hover-revealed
  pencil/trash buttons, which made rows jump several lines tall mid-table. Replaced by a
  fixed one-line row — `checkbox · truncated description · owner avatar` — where the
  **description itself triggers a popover** holding the fields, Cancel/Save *and*
  Delete; "Add" opens the same popover empty. `open-tasks-cell.tsx` was restyled to the
  identical row, keeping the editable cell and its read-only fallback visually the same. The owner
  glyph is the shared `task-owner-avatar.tsx`.
- **Two of this ADR's deliberate scope cuts have now been reversed in part — see
  [ADR 0065](./0065-home-personal-task-list-and-assignee-completion.md) for the full reasoning.**
  Recorded here because both were *explicit rejections* above, and the original reasoning still
  holds for everything else:
  - **The deferred "global My Tasks inbox" is built** — not as a page, but as a **Tasks block in
    the home dashboard's *Your Status* band** (`getMyTasks` + `src/components/home/my-tasks-panel.tsx`):
    every task assigned to you, newest-assigned first, searchable (description *and* parent name),
    filterable by parent kind, with an **Archive** dialog holding the completed history. The door
    this ADR left open — `ownerStaffId` plus per-owner indexing — is what it walked through; the
    per-owner index is the new fourth one, `tasks_owner_done_idx` on
    `(ownerStaffId, done, createdAt desc)` (`drizzle/0023_panoramic_ben_parker.sql`), because all
    three indexes above lead with a **parent** and none can serve an owner-first read. **Tasks are
    still entity-scoped in the model** — every task hangs off exactly one CRM parent, and nothing
    is created or reassigned from home. `@`-mentions remain unbuilt.
  - **`setTaskDone` now has an owner path: the task's *assignee* may always complete it**; anyone
    else still needs `crm.edit` (`canCompleteTask` + the `authorizeTaskDone` hook, the decision
    itself in the pure `src/lib/crm/task-completion.ts`). **The "per-task ownership is
    over-engineered" rejection above stands for `createTask` / `updateTask` / `deleteTask`, which
    are unchanged** — rewording or destroying a task *is* editing CRM data, exactly as this ADR
    argued. What the original reasoning missed is that `crm.edit` is held only by
    sales/manager/admin while `ownerStaffId` can point at **any** staff row, so an engineer or a
    finance lead handed a task could not tick it off. Invisible while tasks lived only on CRM
    detail pages; fatal once a personal todo list made completion the primary interaction. **No new
    capability and no matrix change** — the shape is [ADR 0014](./0014-rbac-better-auth-access-control.md)'s
    `canEditStaff` (own always, others behind the capability). So the claim "all gated `crm.edit`,
    no per-task ownership" in *Decision* above is now true of **three of the four** actions.
- **Completing a task in that cell no longer removes the row — it becomes a one-click
  undo.** A ticked task keeps rendering below the open ones, struck through; unticking
  calls `setTaskDone { done: false }`. The state is a **`Map<id, { task, done }>` of
  *overrides*** (tasks whose done-state this cell changed during the visit), **not** a
  simple "completed" list, because the server list carries only *open* tasks and lags a
  `router.refresh()` behind every toggle — so the gap has to be papered over in **both**
  directions: a just-completed task is **still in** `tasks` (render it struck, not
  twice), and a just-reopened one has **left** the local pile but hasn't reappeared in
  `tasks` yet (keep rendering it, or undo blinks the row away). Overrides are
  session-scoped — a navigation or hard reload clears them, the intended lifetime for an
  undo affordance. **Completed rows are deliberately not editable** (plain text, no
  popover trigger): the cell is holding the last copy it saw of a task the server no
  longer returns, so an edit there would silently drift from the row.
- **The company's own task section moved into a tab and is titled "Next steps".** This
  ADR added it as a `<DetailSection title="Tasks">` sitting *below* the company detail
  tabs; it now lives (with the Notes log) inside a third, **default** company tab named
  **Notes**, and the section header reads "Next steps" — matching the contact page,
  whose equivalent tab is still named **Activity**. See
  [domains/crm.md](../domains/crm.md) and [ui.md](../ui.md).
