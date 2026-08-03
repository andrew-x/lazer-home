# 0065 — A personal task list on the home dashboard, and the assignee's right to complete

**Status:** accepted · 2026-08-03 · **partially reverses two explicit scope cuts in
[ADR 0043](./0043-tasks-entity-replaces-crm-next-steps.md)** — the deferred global
"My Tasks" inbox, and "no per-task ownership" **for completion only** (0043's
reasoning still holds for create/update/delete, which are unchanged) ·
**complements [ADR 0063](./0063-home-dashboard-two-time-bases-and-point-in-time-staffing.md)**:
a *third* kind of figure in the Your Status band, and its §2 window rule is
satisfied in a different place, not relaxed · reuses
[ADR 0014](./0014-rbac-better-auth-access-control.md)'s owner-path shape ·
**schema: one index** (`drizzle/0023_panoramic_ben_parker.sql`) ·
**no permission-matrix change**

## Context

[ADR 0043](./0043-tasks-entity-replaces-crm-next-steps.md) made tasks **entity-scoped
only** and deferred a global inbox, leaving `ownerStaffId` and per-owner indexing as
the open door. That door had to be opened for two reasons that only became visible
once tasks were in real use:

- **A task's assignee had no way to see their own list.** Finding what was assigned to
  you meant opening every company, contact and opportunity you might be named on. The
  entity is a to-do list; there was no list.
- **The gate contradicted the data model.** `crm.edit` is held by `sales` / `manager` /
  `admin`, but `tasks.ownerStaffId` can point at **any** staff row. So a task could be
  assigned to an engineer, a QA lead or someone in finance who then **could not tick it
  off**. Under the entity-scoped UI that was near-invisible (those people rarely open a
  contact page); a personal todo list makes completion *the* primary interaction, so the
  list would have been read-only for exactly the people whose list it is.

## Decision

### 1. The list is a block in **Your Status** on `/`, not a route of its own

`MyTasksPanel` (`src/components/home/my-tasks-panel.tsx`) renders inside the existing
Your Status band: every task assigned to you, **newest-assigned first**, with a search
box, a parent-kind filter, tick-to-complete, and an **Archive** dialog for the full
history. A separate `/tasks` route is a place you have to remember to visit; `/` is
already the first page of the day, and "what's on my plate" belongs beside "what am I
staffed on".

**This puts a point-in-time figure in a year-to-date band, and that is why the band's
description changed.** It used to read *"Your work this year — 1 January to today, from
your timesheets."* — which is no longer true of everything in the band. It now reads
*"Your year so far, and what's on your plate. Each figure below names its own window."*
[ADR 0063 §2](./0063-home-dashboard-two-time-bases-and-point-in-time-staffing.md) is
**unchanged and still satisfied** — the window is named on the stat-tile hints and in
the Tasks caption ("Assigned to you — open right now… Anything a week or more old is
flagged") rather than once at the top. Same rule, different place. The Planned tile's
over-allocated hint was reworded for the same reason: it now reads *"Confirmed work
against capacity · YTD — over-allocated today (N%)"*, keeping **· YTD** on the headline
figure while the over-allocation note carries its own "today".

### 2. The task's assignee may always complete it; anyone else needs `crm.edit`

`setTaskDone` swapped `permission: { crm: ["edit"] }` for
`authorize: authorizeTaskDone`. **`createTask` / `updateTask` / `deleteTask` keep the
flat `crm.edit` gate** — rewording or destroying a task is editing CRM data; closing
out your own assignment is not.

- **Same shape as [ADR 0014](./0014-rbac-better-auth-access-control.md)'s
  `canEditStaff`:** a decision function (`src/actions/crm/canCompleteTask.ts`) plus an
  `ActionAuthorize` hook in metadata, never authorization in the body. The rule itself
  is the pure, unit-tested `taskCompletionAllowed`
  (`src/lib/crm/task-completion.ts`), which takes the **already-evaluated** `crm.edit`
  boolean — it re-implements no role check, so `permissions.ts` stays the only place a
  role is interpreted.
- **`crm.edit` short-circuits before the DB is touched**; only a non-holder pays for the
  owner lookup.
- **A null owner or a null caller never matches.** Comparing two nulls as equal would
  hand every unassigned task to every account with no linked staff row. An unowned task
  is therefore completable only by a `crm.edit` holder.
- **An unknown task id denies** for anyone without `crm.edit` (you can't own a row that
  isn't there); the body's `assertRowExists` owns the not-found message.
- **`ownStaffId(user.id)` with `activeOnly` off** — this is an *ownership* check (the
  caller is resolved only to compare against their own id), the right-hand column of
  permissions.md's `activeOnly` table.

**Why not widen `crm.edit` in the matrix:** it grants CRM-wide write access, and nobody
needed that — only "close the thing assigned to me". **Why not a new
`tasks.complete` capability:** completion isn't role-shaped. It follows the
*assignment*, which the row already records; a capability would grant it to a role and
still miss the individual it was handed to.

### 3. The read takes no `staffId` — own-data-only by construction

`getMyTasks()` (`src/actions/crm/getMyTasks.ts`) resolves the subject from the session,
exactly like `getMyAllocations`: **there is no cross-user id to authorize, so there is
no gate to get wrong.** No linked staff record ⇒ empty lists, not an error.

Two queries: all **open** tasks by `createdAt desc` (unbounded — a personal backlog is
self-limiting, and the staleness flag is what surfaces its old end), plus **completed**
by `completedAt desc` capped at `ARCHIVE_LIMIT`.

**`MyTaskView` is a disclosure whitelist**, for the reason ADR 0063 §5 spells out: it is
a Client Component prop on `/`, so every field is serialized into the page HTML.
Fields are copied one at a time and **never spread** — `ownerStaffId`,
`creatorStaffId` and `updatedAt` are all withheld. The view also carries **no
`staffId`**: the caller already has its own, so including it would ship a dead field,
the same reasoning `org-status.ts` gives for dropping `freeFrom`.

### 4. Ticking a task off deliberately does **not** hide it

Both surfaces filter by a completion state that a tick immediately contradicts (the
panel shows *open*; the archive defaults to *Completed*), so the naive behaviour is
that the row you just clicked unmounts and **the next reflexive click lands on whatever
shifted up into its place.** The panel therefore holds a `Map<taskId, boolean>` of
done-states changed during this visit and passes the key set to the dialog as
**`keepIds`**, which exempts those rows from the **status** filter.

- **Status only.** Search text and parent kind still apply: a kept row that no longer
  matches what you typed *should* hide, because that's the person narrowing the list,
  not the list moving on its own.
- **Session-scoped.** A reload is the moment a finished task drops out — the override
  exists to make a mis-click one click to undo, not to keep closed work on screen.
- Overrides are applied **once, in the pipeline** (`applyDoneOverrides`), not per
  component, so the status filter, the staleness flag and the strike-through can't
  disagree about whether a task is done. Reopening also clears `completedAt`, or a
  reopened row would read "Done \<date\>" until the refresh landed.

This is the same problem `contact-tasks-cell.tsx` solved (ADR 0043 *Since*), but a
**simpler** state: that cell's server list carries only *open* tasks, so it must hold
the task object itself; here the read returns both halves, so a boolean per id is
enough.

### 5. Two different sort orders, on purpose

The panel sorts by **assignment date** (`mergeMyTasks`) so ticking a row never makes it
jump position under the cursor. The archive sorts by **most recently completed**
(`sortMyTasksByRecency`) because its question is "what did I close out, and when" — a
long-standing task finished yesterday belongs at the top, and this is also the key the
read's `ARCHIVE_LIMIT` window selects on, so display and truncation agree.

### 6. The archive is capped at 200, and says so

Open tasks are bounded by a person's own behaviour; **completed ones accumulate
forever** and the payload crosses to the client. `completedTruncated` drives a line in
the dialog stating the cap, so the archive never implies it showed everything.
`ARCHIVE_LIMIT` lives in the pure `src/lib/home/my-tasks.ts` rather than beside the
read, because a Client Component quotes the number back and can't import a
`"server-only"` module.

### 7. Staleness is an **open**-tasks-only flag, computed off a server-stamped `nowMs`

`STALE_TASK_DAYS = 7`; an open task at or past it gets an amber left border **plus a
labelled "N days old"** — colour alone would be unexplained. A **completed task is
never stale**, however old: the flag means "this needs attention", not "this is old",
and without that rule the archive would light up amber end to end. `nowMs` is stamped
in the Server Component and passed down so the threshold resolves identically across
hydration.

### 8. A fourth index on `tasks`, and what it deliberately doesn't cover

`tasks_owner_done_idx` on `(ownerStaffId, done, createdAt desc)`. The three existing
indexes all lead with a **parent** FK, so none of them can serve a read that leads with
the **owner** — this list is the first read that goes the other way round. The
completed query orders by `completedAt`, which this index cannot sort; that is accepted
rather than fixed with a second index, since one person's closed tasks are a small set
and the read caps them anyway.

### 9. An opportunity parent links to `/opportunities`, not a detail route

`taskParentHref` (`src/lib/crm/task-parent-link.ts`) sends companies and contacts to
their detail pages and **opportunities to the board** — there is no
`/opportunities/[id]`; an opportunity renders only in the board drawer. Don't "fix"
this by inventing a detail href: it would 404. That module is the *display* side
(labels + hrefs, client-importable) and is deliberately **not**
`src/actions/crm/taskParent.ts`, the server-only kind → FK-column map.

## Consequences

- **ADR 0043's "all four actions gate solely on `crm.edit`, no per-task ownership" is
  now true of three of the four.** Its *Alternatives considered* rejection of per-task
  ownership stands for create/update/delete and is reversed for completion only; its
  deferral of a global inbox is spent. Both are recorded in that ADR's *Since* section.
- **`crm.edit` is no longer a purely flat capability.** permissions.md's "two flat write
  capabilities gate data entry (no ownership dimension)" was false the moment this
  landed; the completion path is the **first ownership dimension inside the CRM
  domain**. The role matrix, `permissions.ts` and `permissions.test.ts` are all
  **untouched** — there is no new capability, so ADR 0014's lockstep rule isn't
  engaged, and `/audit-rbac` passed clean.
- **`/` reads the CRM now.** The home route previously touched allocations, staff and
  timesheets only; it is the first cross-domain surface to read `tasks`, and the first
  to read tasks **across parents**.
- **Filtering is shared, not duplicated.** `filterMyTasks` (with `keepIds`) is used by
  both the panel and the dialog, so a change to what "search" means can't apply to one
  and not the other. All of `src/lib/home/my-tasks.ts` and
  `src/lib/crm/task-completion.ts` are pure and unit-tested (the door
  [ADR 0037](./0037-unit-tests-removed-except-rbac-matrix.md) leaves open for rules the
  types can't express — here an access rule and a staleness definition).
- **In-memory filters, nothing in the URL** — the whole list is already on the client
  and `/` deliberately keeps no URL state (ADR 0063 §6). Hence `SearchFilter`, the
  presentational control, not `useUrlSearchFilter`, which navigates.
- **Still not built:** due dates, reminders/notifications, prioritisation or manual
  ordering, and **creating or reassigning a task from home**. A task is still created
  only on a CRM parent — this surface reads and completes.

## Alternatives rejected

- **Widen `crm.edit` in the role matrix** so everyone holds it — rejected: it grants
  CRM-wide write access to solve a one-action problem.
- **A new `tasks.complete` capability** — rejected (§2): completion follows the
  assignment on the row, not the role.
- **Leave `setTaskDone` on `crm.edit` and just not show the checkbox to others** —
  rejected: it makes the list a read-only reminder for most of the company, and the
  people it fails are the ones the feature exists for.
- **Hide a task the moment it's ticked** — rejected (§4): the row vanishes under the
  cursor and the next click lands on an unrelated task.
- **Persist the done-overrides** (localStorage or the URL) — rejected: a completed task
  *should* drop out on reload, and a persisted keep-set only grows, so the list would
  never settle.
- **One combined list instead of panel + archive** — rejected: an unbounded completed
  history buries the handful of open tasks that are the point.
- **Server-side search/filter via URL params** — rejected: a round trip per keystroke
  for data already in the payload, and it would put the first URL state on `/`.
- **A dedicated `/tasks` route** (0043's original phrasing of the deferred inbox) —
  rejected for now (§1): another destination to remember, when the band people already
  read every morning is right here. If the list ever outgrows a block, the panel is
  already self-contained enough to move.
