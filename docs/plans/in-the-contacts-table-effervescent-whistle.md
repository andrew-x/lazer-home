# Contacts table: name search, merged Name/Role column, editable Next steps

## Context

The contacts list (`/contacts`) is the only CRM list without a text search — companies,
opportunities, and projects all have one, so finding a person means paging or filtering
by city. The table also spends a whole column on the free-text job title (`contacts.role`),
which is really an attribute of the person's name line, not an independent axis. And the
"Next steps" column is a dead read-only list (`OpenTasksCell`): to tick off a task, fix a
typo, or add a follow-up you have to open the contact detail page and come back.

The goal: make the contacts table a place you can actually work from — search by name,
recover a column, and manage a contact's open tasks in place.

Three notes on the current state, so the change is scoped honestly:

- The Next steps cell **already** shows every open (not-done) task — `openTasksByParent`
  filters `done = false` with no limit. What makes it look truncated is the per-item
  `line-clamp-1`. So requirement #3 is entirely about interactivity, plus loosening the clamp.
- `contacts/page.tsx` already computes `canEdit` but never passes it down; the table is a
  pure server component today. Interactivity means a new **client cell**, with `canEdit`
  and the current user's staff identity threaded from the page. The table itself stays a
  server component.
- Nothing here touches RBAC. The cell calls the four existing task actions
  (`createTask` / `updateTask` / `setTaskDone` / `deleteTask`), all already gated
  `permission: { crm: ["edit"] }` in `secureActionClient` metadata. `canEdit` in the UI is
  a display concern only — the server gate is unchanged and remains authoritative.

## Decisions taken (confirmed)

- **Cell UX:** fully inline in the cell — checkbox + text per task, hover-revealed
  pencil/trash, an always-present muted "Add next step" affordance at the bottom.
- **Search scope:** name only — first name, last name, and the `"First Last"` concatenation
  (so `jane sm` finds Jane Smith).
- **Owner:** the inline editor includes the staff owner picker. New tasks added from the
  table default to the current user, matching the detail page.

---

## 1. Server: name search on the contacts page

**`src/actions/crm/getContactsPage.ts`**

- Add `query?: string` to `ContactListFilters`.
- Convert `contactsWhere` from the single-`return` shape to the `conditions: SQL[]` +
  `and(...conditions)` shape already used by `companiesWhere` in
  `src/actions/crm/getCompaniesPage.ts`.
- Name predicate — escape the term (existing `getCompaniesPage` / `getOpportunitiesPage`
  do **not**, which is a latent bug in those; use `escapeLike` here, as
  `src/actions/crm/searchContacts.ts` and `src/actions/shared/entitySearch.ts` do):

  ```ts
  const term = `%${escapeLike(query)}%`; // escapeLike from @/lib/core/like
  conditions.push(
    or(
      ilike(contacts.firstName, term),
      ilike(contacts.lastName, term),
      ilike(sql`${contacts.firstName} || ' ' || ${contacts.lastName}`, term),
    ),
  );
  ```

  Both `firstName` and `lastName` are `notNull` (`src/lib/db/crm-schema.ts:46-47`), so the
  concatenation never collapses to NULL.
- The `where` is already applied to both the `count()` and the row query, so `pageCount`
  stays correct for the filtered set — no change needed there.

**`src/app/(app)/contacts/page.tsx`**

- Parse `q` alongside `city` / `nearby`, pass it as `query` to `getContactsPage`.
- Widen the `filtered` prop: `filtered={city !== undefined || q !== undefined}` (its
  doc comment on `ContactsTable` currently says "location filter" — update it).

## 2. Client: the search input (and de-duplicate it)

`src/components/crm/contacts-list-filters.tsx` needs the debounced-URL search block that
already exists **verbatim three times** — `companies-list-filters.tsx`,
`opportunities-list-filters.tsx`, `projects-list-filters.tsx`. Rather than ship a fourth
copy, extract it once:

**New `src/components/form/search-filter.tsx`** exporting:

- `useUrlSearchFilter({ basePath, pageKey, params })` → `{ search, setSearch }`. Contains
  the existing `useState` + `useDebouncedValue(search, 300)` + the two `useEffect`s
  (external-sync and debounce→`router.replace(buildListHref(...))`) exactly as written in
  `companies-list-filters.tsx:38-59`, including the `if (debouncedSearch !== search) return`
  guard and its comment — that guard is load-bearing.
- `<SearchFilter value onChange placeholder />` — the `FilterLabel` + `IconSearch` +
  `Input className="pl-9"` markup, with `useId` internal.

Then:

- Add the search field to `contacts-list-filters.tsx` (placeholder `"Search by name…"`),
  wire `hasFilters` to include `currentQuery !== ""` so "Clear filters" appears for a
  search alone.
- Migrate the three existing filter bars onto the shared pieces. Pure refactor — no
  behaviour change, and `bun run check` + `bun run build` cover it. **This step is
  separable**: if it turns risky, drop it and inline a fourth copy in contacts only.

## 3. Merge Role into the Name column

**`src/components/crm/contacts-table.tsx`** — drop the `Role` `<TableHead>` and its cell;
render the title under the name:

```tsx
<TableCell className="font-medium">
  <InternalLink href={`/contacts/${contact.id}`}>
    {contact.firstName} {contact.lastName}
  </InternalLink>
  {contact.role ? (
    <div className="text-xs font-normal text-muted-foreground">{contact.role}</div>
  ) : null}
</TableCell>
```

`ContactRow.role` stays in the query — only the presentation changes.

Apply the same treatment to the company detail's mini contacts table
(`src/components/crm/company-detail-view.tsx:124-140`, `DetailTable headers={["Name",
"Role", "Next steps"]}` → `["Name", "Next steps"]`) so the two contact tables don't
diverge. That table's Next-steps cell stays read-only `OpenTasksCell` — the interactive
cell is for the list page.

## 4. Interactive Next steps cell

### 4a. Carry the owner through the summary

**`src/actions/crm/getTasks.ts`** — extend `OpenTaskSummary` to
`{ id, description, ownerId: string | null, ownerName: string | null }` and add an
`alias(staff, "task_owner")` left join to `openTasksByParent`, mirroring
`getTasksForParent`. Purely additive: the three consumers (`getContactsPage`,
`getCompanyDetail`, `getOpportunitiesBoard`) keep compiling untouched, and `updateTask`
requires `ownerId` in its input, so the cell needs it to round-trip the picker.

### 4b. Share the task fields

**New `src/components/crm/task-fields.tsx`** — move the `TaskFields` sub-component out of
`task-list.tsx` (currently lines 56-105) unchanged, plus one new prop
`stacked?: boolean` that forces `flex-col` instead of `sm:flex-row` (a table cell is
narrow even on a wide viewport, so the responsive breakpoint reads the container wrong).
`task-list.tsx` imports it; behaviour there is identical.

### 4c. The cell

**New `src/components/crm/contact-tasks-cell.tsx`** (`"use client"`), props:
`{ contactId, tasks: OpenTaskSummary[], canEdit, currentStaff: EntityOption | null }`.

Model it closely on `task-list.tsx` — same four `useAction` hooks, same
`pendingDoneId` / `editingId` / `editDraft` / `editOwner` / `deletingId` state, same
`router.refresh()` on success. Differences forced by the cell context:

- **Read-only fallback:** when `!canEdit`, render the existing `OpenTasksCell` and stop.
- **Row:** `<Checkbox onCheckedChange={…setTaskDone({ id, done: true })}>` + description
  (`line-clamp-2`, dimmed + struck while its toggle is pending) + hover/focus-revealed
  `IconButton` pencil & trash, using the `opacity-0 group-hover/tasks:opacity-100
  group-focus-within/tasks:opacity-100` pattern from `task-list.tsx:305`. Scope the group
  to a wrapper `<div className="group/tasks">` inside the cell, not the `<TableRow>`, so
  hover reveal is local to the column.
  Checking a task off makes it vanish on refresh (only open tasks are fetched) — that's
  the intended behaviour, but keep the local pending state so the row visibly commits
  before the refresh lands.
- **Edit:** swaps that line for `<TaskFields stacked … />` + Save/Cancel, `autoFocus`.
- **Add:** a low-emphasis full-width ghost button ("Add next step",
  `text-xs text-muted-foreground opacity-70 hover:opacity-100`) that reveals the stacked
  `TaskFields` composer with the owner prefilled to `currentStaff`; Enter or Add submits,
  Escape/blur-cancel collapses it. Always rendered (including on empty cells, in place of
  `EmptyCell`) rather than hover-only — a hover-only affordance on an empty cell is
  undiscoverable.
- **Errors:** `toast.error(result.serverError)` rather than the inline `<p>` `task-list`
  uses — there is no room in a cell. Precedent:
  `src/components/crm/inline-relationship-strength-field.tsx`.

### 4d. Wire it up

- `src/app/(app)/contacts/page.tsx`: add `getCurrentStaffIdentity()` to the existing
  `Promise.all`, pass `canEdit` and `currentStaff` into `<ContactsTable>`.
- `src/components/crm/contacts-table.tsx`: accept both, render `<ContactTasksCell>`.
  The table stays a server component; only the cell crosses the client boundary.

`OpenTasksCell` stays — it is still used by the company detail table and as the cell's
read-only fallback.

---

## Verification

1. `bun run check` (Biome + `tsc --noEmit` + `bun test`, incl. the RBAC matrix test) and
   `bun run build`.
2. `bun run dev`, then on `/contacts`:
   - Type a partial first name, last name, and `"first last"` — results narrow, the URL
     gains `?q=`, `contactsPage` resets, pagination count matches, back-button restores.
   - "Clear filters" appears for a search alone and clears it; the input re-syncs.
   - Type a `%` or `_` — treated literally, not as a wildcard.
   - Name cell shows the job title beneath the name; no Role column; contacts with no role
     render just the name.
   - As a `sales`/`manager`/`admin` user: tick a task off (it disappears), edit one
     (text + reassign owner, verify on the detail page), delete one, add one (owner
     defaults to you). Every change survives a hard reload.
   - As a role **without** `crm.edit` (e.g. `staff`): the cell is read-only — no checkbox,
     no add button, no pencil/trash.
   - Regression-check the shared search extraction on `/companies`, `/opportunities`,
     `/projects`, and the merged Name column on a company detail page's Contacts tab.
3. Run `/code-review` on the diff before merging.
4. Dispatch the **librarian** subagent: `docs/domains/crm.md` (contacts list filters,
   `ContactRow`, table column sets) and `docs/ui.md:142` (which currently records that the
   contacts table's tasks column is deliberately the shared read-only `OpenTasksCell` —
   that decision is being reversed for the list page and needs restating).
