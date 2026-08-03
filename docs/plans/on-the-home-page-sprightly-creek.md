# My Tasks on the home dashboard

## Context

Tasks already exist as a first-class entity (`tasks` table, ADR 0043) — assignable, completable to-dos hanging off exactly one CRM parent (company / contact / opportunity), with `ownerStaffId` as the assignee and `createdAt` as the assigned date. But **there is no way to see the tasks assigned to *you***. They are only reachable by navigating to the CRM parent that happens to own them, so a person's actual backlog is scattered across companies, contacts and the opportunity board with no single place to work it.

This adds that place: a personal todo list on the home dashboard, inside the **Your Status** band — every task assigned to the signed-in user, newest first, showing when it was assigned and what it relates to, checkable in place, with search, a parent-kind filter, a stale-task highlight, and a dialog for the full history.

**No new table.** The only schema change is a supporting index. The one non-trivial change is an authorization widening (below).

### Two things worth knowing before starting

**1. `setTaskDone` is gated wrong for this feature.** It currently declares `permission: { crm: ["edit"] }` — held only by `sales`, `manager`, `admin`. A `user`, `delivery-manager` or `finance` staffer assigned a task **cannot check it off**. Shipping the panel on that gate means a checkbox disabled for much of the org. Decision: **the task's owner may always complete their own task; everyone else still needs `crm.edit`.** This is a deliberate, documented widening along an established pattern (`authorizeStaffEdit` → `canEditStaff`: owner always, others need the capability) — not a bypass. Scope is *completion only*: `updateTask` and `deleteTask` keep their plain `crm.edit` gate, because editing a task's text or destroying it is CRM data editing, whereas ticking off your own assignment is not.

**2. This lands inside a band with a stated contract.** ADR 0063 fixes Your Status as *"year to date, from your timesheets"*, and bans the bare word "utilization" there because the two home bands measure different windows. Tasks are neither year-to-date nor timesheet-derived. Placing them inside that band (the chosen option) therefore requires rewording the band description and its doc comment so the section no longer claims a single window, and giving the task block its own sub-heading that names *its* window. Otherwise the band's own documentation becomes false — the exact failure ADR 0063 exists to prevent.

## Approach

### 1. Schema — one index (`src/lib/db/tasks-schema.ts`)

Every existing index on `tasks` is per-parent (`tasks_contact_done_idx` etc.). The new read is "my tasks, by done, newest first", which nothing supports. Add:

```ts
// The home dashboard's personal todo list: one owner's tasks, split by done,
// newest first. The three parent indexes above can't serve it.
index("tasks_owner_done_idx").on(t.ownerStaffId, t.done, t.createdAt.desc()),
```

Mixed-direction indexes are already used (`projectDeliveryNotes`). Then `bun run db:generate` → `bun run db:migrate`. **No seed change** — `tasks` is already in `SEEDABLE_TABLES`, and `scripts/seed/tasks.ts` already spreads `createdAt` over 45 days with ~35% done across random owners, which exercises both the stale highlight and the archive.

### 2. Read — `src/actions/crm/getMyTasks.ts` (new, `import "server-only"`)

Follows `getMyAllocations()`: **takes no `staffId`**, resolves the caller via `getCurrentStaffId()`. Own-data-only by construction, so there is no id to authorize and no gate to add.

Two queries in one `Promise.all`, both `leftJoin`ing `companies`, `contacts` and `opportunities` to resolve the parent name (a `COALESCE`-style pick in JS from the three nullable names, keyed off which FK is set):

- **open** — `ownerStaffId = me AND done = false`, `orderBy desc(createdAt)`, unbounded.
- **completed** — `ownerStaffId = me AND done = true`, `orderBy desc(completedAt)`, `limit(ARCHIVE_LIMIT)` (200) — a person's completed history is unbounded over time and this payload ships to the client.

Return `{ staffId, open, completed, completedTruncated }`. Set `completedTruncated` when the limit is hit so the dialog can say so rather than silently pretending it showed everything.

Row type — **built field-by-field, never spread.** This payload crosses into a Client Component on the home route, which is exactly the disclosure boundary `src/lib/home/org-status.ts` documents at length; copy that module's header rationale and its enumerate-don't-spread comment:

```ts
export type MyTaskView = {
  id: string;
  description: string;
  done: boolean;
  createdAt: number;          // epoch millis — the TaskView convention
  completedAt: number | null;
  parentKind: TaskParentKind;
  parentId: string;
  parentName: string;
};
```

Reuse `TASK_PARENT_COLUMN` from `src/actions/crm/taskParent.ts` for the kind→column map; reuse `TaskParentKind` from `src/actions/crm/tasks.schema.ts`.

### 3. Authorization — `src/actions/crm/canCompleteTask.ts` (new)

Mirrors `src/actions/staff/canEditStaff.ts`:

```ts
/** Owner-path gate: you may always complete a task assigned to you; anyone
 *  else completing someone else's task needs `crm.edit`. */
export async function canCompleteTask(user, taskId: string): Promise<boolean>
export const authorizeTaskDone: ActionAuthorize = async ({ user, clientInput }) => { ... }
```

`clientInput` is **raw and pre-validation** — narrow it yourself (`typeof x.id === "string"`) before use; a malformed id must fall through to `requirePermission(user, { crm: ["edit"] })`, never to allow. Look up `tasks.ownerStaffId` for the id, compare against `getCurrentStaffId()`; equal → return, otherwise `requirePermission`. A missing/unknown task falls through to the capability check (`assertRowExists` in the body still owns the not-found message).

Then in `src/actions/crm/setTaskDone.ts`, swap the metadata and update the doc comment:

```ts
.metadata({ action: "set-task-done", authorize: authorizeTaskDone })
```

**The role matrix does not change**, so `src/lib/auth/permissions.ts` and `src/lib/auth/permissions.test.ts` are untouched. `docs/domains/permissions.md` does change — it already has an "owner-path capability" section and describes review notes as *the* relationship gate; this adds a second owner path and that framing needs updating. Add a unit test for `canCompleteTask` covering: owner without `crm.edit` → allowed; non-owner without `crm.edit` → denied; non-owner with `crm.edit` → allowed; unknown task id → denied for a plain user.

### 4. Pure, tested logic

**`src/lib/crm/task-parent-link.ts`** (new, client-importable, no db/drizzle):
- `TASK_PARENT_LABELS: Record<TaskParentKind, string>` — "Company" / "Contact" / "Opportunity".
- `taskParentHref(kind, id)` — `/companies/{id}`, `/contacts/{id}`, and **`/opportunities`** for opportunities: per the comment in `taskParent.ts` there is no `/opportunities/[id]` route, they render only in the board drawer. Don't invent one.
- Named `task-parent-link.ts`, not `task-parent.ts`, to stay clearly distinct from the server-only `src/actions/crm/taskParent.ts`.

**`src/lib/home/my-tasks.ts`** (new) — joins `org-status.ts` / `my-work.ts` as a pure, client-importable, tested home module. Both the panel and the dialog filter the same way, so it lives here once:
- `STALE_TASK_DAYS = 7`
- `taskAgeDays(createdAtMs, nowMs)` and `isStaleTask(task, nowMs)` — stale only applies to **open** tasks; a completed one is never flagged.
- `filterMyTasks(tasks, { query, kind, status })` — case-insensitive substring match over **description and parent name**, plus optional parent-kind and open/completed narrowing.

**`src/lib/home/my-tasks.test.ts`** — cover the filter (empty query, kind narrowing, parent-name match, combined) and the staleness boundary (6 / 7 / 8 days, and a completed 30-day-old task not flagged).

### 5. UI

**`src/components/home/my-task-row.tsx`** (new, `"use client"`) — one row, shared by panel and dialog. Ports the proven bits of `src/components/crm/task-list.tsx` and `src/components/crm/contact-tasks-cell.tsx`:

- `Checkbox` with an explicit `aria-label`, driving `useAction(setTaskDone)`.
- **One `useAction` hook per row** — a shared hook drops superseded results and would swallow the first row's error (documented in `contact-tasks-cell.tsx`).
- Show the destination state while in flight so the tick and strike-through land on click, not after the round trip: `const struck = toggle.isPending ? !done : done;`
- Errors → `toast.error(error.serverError ?? "Something went wrong.")` (no room for inline error text in a dense row); `onSuccess` → `router.refresh()`.
- Body: description (`line-through text-muted-foreground` when struck), then a meta line — parent kind label + parent name as an `InternalLink` to `taskParentHref`, `·`, `formatShortDate(new Date(createdAt))` (or `Done {date}` when complete), matching `task-list.tsx`'s meta line exactly.
- **Stale highlight** (open, `createdAt` older than 7 days): reuse the soft-amber warning tone already established for over-allocation in `src/components/allocations/allocations-grid.tsx` (`border-amber-300` / `bg-amber-100` / `text-amber-900`) — the app has no `warning` token, and amber is its existing soft-warning vocabulary. Apply as `border-l-2 border-l-amber-400` on the row (rows already carry `border-l-2 pl-3`) plus the age in `text-amber-900`, e.g. `· 12d old`, so the highlight explains itself rather than being unlabelled colour.

**`src/components/home/my-tasks-panel.tsx`** (new, `"use client"`) — the panel:

- Local `useState` for `search` and `kind` (`ALL` sentinel), one `useMemo` over `filterMyTasks`. **In-memory, not URL params**, following `src/components/staff/staff-directory.tsx`: the data is already client-side, and the home route deliberately keeps no URL state (the Lazer Status band's filters are `useState` for the same reason). Reuse the controlled `SearchFilter` (`src/components/form/search-filter.tsx`) and `SegmentedFilter` + `ALL` (`src/components/form/filters.tsx`) — all three take `value`/`onChange` and are router-free. Do **not** use `useUrlSearchFilter`; that hook is URL-backed.
- **Checking off does not hide the row.** Keep a local `overrides: Map<string, MyTaskView>` of tasks ticked during this visit — the `router.refresh()` drops them from `open`, and the map keeps them rendered struck-through with the checkbox still live for one-click undo. This is the exact pattern and rationale documented in `contact-tasks-cell.tsx`.
- Filter bar layout `flex flex-wrap items-end gap-3`, with the archive trigger at the end of the row.
- `EmptyState` (`src/components/empty-state.tsx`) with a filtered-aware message: `filtered ? "No tasks match your filters." : "Nothing assigned to you."`
- Takes `nowMs` as a **prop from the server**, never `Date.now()` in render — the codebase already threads `today` down (`MyAllocationsTable today={today}`, `buildOrgStatus(..., currentDay(), ...)`) precisely to avoid a server/client hydration mismatch on the date.

**`src/components/home/task-archive-dialog.tsx`** (new, `"use client"`) — the full history:

- `Dialog` via the vendored primitive. Title "Your tasks"; trigger button labelled "Archive".
- Its own `search` + `kind` state plus a **status** `SegmentedFilter` (All / Open / Completed) **defaulting to Completed**, so the trigger honours "view archived tasks" while the dialog can still show everything, as chosen.
- Renders `MyTaskRow` over `[...open, ...completed]`, so ticking off inside the dialog works identically.
- When `completedTruncated`, a muted footnote: "Showing your 200 most recently completed tasks." — never silently truncate.

### 6. Wiring — `src/app/(app)/page.tsx`

Inside `YourStatusSection`, add `getMyTasks()` to the existing `Promise.all` alongside `getStaffPto` / `getStaffUtilization` (it runs after the `!staffId` early return, which already covers the no-staff-record case). Render `MyTasksPanel` below `MyAllocationsTable`, under its own `<h3>` sub-heading "Tasks" with a one-line caption naming its window (e.g. "Assigned to you — open now").

Then reword the band so it stays true:
- The `HomeSection` description "Your work this year — 1 January to today, from your timesheets." no longer describes the whole band. Change to something that doesn't claim one window (e.g. "Your year so far, and what's on your plate."), leaving the per-window claims where they already are: on each `StatCard`'s `hint` and now on the Tasks sub-heading.
- Update the page's top doc comment: its Your Status bullet asserts the band is YTD-from-timesheets. Note that the band now also carries point-in-time task state, and that this is why the description was generalized and each block names its own window — the ADR 0063 rule (every figure names its window) is preserved, its wording is not.

Nav is untouched — this is not a new route.

## Files

| File | Change |
|---|---|
| `src/lib/db/tasks-schema.ts` | add `tasks_owner_done_idx` |
| `drizzle/00XX_*.sql` | generated (index only) |
| `src/actions/crm/getMyTasks.ts` | **new** — server-only read, `MyTaskView`, field-by-field |
| `src/actions/crm/canCompleteTask.ts` | **new** — `canCompleteTask` + `authorizeTaskDone` |
| `src/actions/crm/canCompleteTask.test.ts` | **new** — owner / non-owner / capability / unknown id |
| `src/actions/crm/setTaskDone.ts` | `permission` → `authorize`; update doc comment |
| `src/lib/crm/task-parent-link.ts` | **new** — labels + hrefs (pure) |
| `src/lib/home/my-tasks.ts` + `.test.ts` | **new** — filter + staleness (pure) |
| `src/components/home/my-task-row.tsx` | **new** |
| `src/components/home/my-tasks-panel.tsx` | **new** |
| `src/components/home/task-archive-dialog.tsx` | **new** |
| `src/app/(app)/page.tsx` | fetch + render; reword band description and doc comment |
| `docs/domains/permissions.md` | owner-path gate for task completion (**librarian**) |
| `docs/domains/crm.md`, `docs/decisions/` | Tasks §, ADR 0063 amendment (**librarian**) |

## Verification

1. `bun run check` — Biome + `tsc --noEmit` + `bun test`. Must be green, including the new `my-tasks` and `canCompleteTask` tests and the untouched permission-matrix test.
2. `bun run build` — full production compile (this is a compile, not a server).
3. `/audit-rbac` — mandatory, because `setTaskDone`'s gate changed. Confirm it reports the owner path as intentional and finds no other action relying on the removed static `crm.edit` gate.
4. `/code-review` on the diff before merging.
5. **Runtime evidence — I'll need you to run it.** I won't start the dev server. Please check, on `/`:
   - Tasks assigned to you appear under Your Status, newest first, each showing its assigned date and a working link to its company / contact / opportunity.
   - Anything assigned more than a week ago is amber-highlighted with an age label; completed tasks are not.
   - The parent-kind filter and the search box both narrow the list (search should also match on the parent's name, not just the description).
   - Ticking a task strikes it through immediately and **leaves it in place**; ticking again restores it. Reloading moves it out of the panel.
   - "Archive" opens the dialog on Completed, with All / Open / Completed, search and kind filters all working, and ticking off inside the dialog behaving the same.
   - Then the gate: sign in as (or temporarily set your role to) a `user` or `finance` account with a task assigned, and confirm you **can** tick it off — that's the whole point of the authorization change — while a task assigned to someone *else* is still not completable from their CRM detail page.
6. Dispatch the `librarian` subagent afterwards with a summary of: the panel, the new read, the owner-path gate on `setTaskDone`, and the ADR 0063 band-description amendment.
