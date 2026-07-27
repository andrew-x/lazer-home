# Tasks — replacing CRM "next steps"

## Context

Today "next steps" on CRM entities is not a field — it's one `kind` value (`next_step`)
on a shared **entries** log that also stores `note`s (ADR 0030). It's a free-text
reminder with no owner, no assignee, and no completion state.

We want a real **task**: something with an **owner** (assignee), a **creator**, a
created date, a done flag, a completion date, and a description. Tasks attach to the
same CRM entities that carry next steps today — **opportunities, companies, contacts** —
and **replace** next steps entirely. Notes are untouched.

### Decisions (confirmed with the user)

- **No `@`-mention.** The description is a plain textarea. The owner is set only via a
  staff picker that **defaults to the current user**. (This drops the original `@`-in-text
  idea — it was the one greenfield/high-risk piece and the user opted out.)
- **Entity-scoped only.** Tasks live as a "Tasks" card on each detail page. No global
  "My Tasks" page, and every task is attached to exactly one CRM parent (no standalone
  tasks) for now.
- **Summary columns show all incomplete tasks.** Where a contact/opportunity list cell or
  board card shows the latest next step today, it will show **all not-yet-done tasks**.
- **Gated behind `crm:edit`** — same capability that gates notes/next steps today. So
  **no change** to `permissions.ts`, the matrix test, or the permissions doc. Reads stay open.
- **Collapse entries to notes-only.** Since next steps are the *only* other `kind`, we
  remove the `kind` discriminator entirely rather than leave a dead enum value — cleaner
  durable state. Entries become "notes", full stop.

## Data model

New file **`src/lib/db/tasks-schema.ts`**, exported from the barrel `src/lib/db/schema.ts`.

Follow the established conventions (camelCase keys + `casing: "snake_case"`, `text()` PK
minted with `generateId("task")`, plain `timestamp()`, concrete typed FKs — **never**
polymorphic). Owner/creator reference **`staff`** (not the auth `user` table), matching
`contactEntries.authorStaffId` and `companies.ownerId`.

```ts
export const tasks = pgTable("tasks", {
  id: text().primaryKey(),
  description: text().notNull(),
  ownerStaffId: text().references(() => staff.id, { onDelete: "set null" }),
  creatorStaffId: text().references(() => staff.id, { onDelete: "set null" }),
  done: boolean().notNull().default(false),
  completedAt: timestamp(), // set when done flips true, cleared when reopened
  // Exactly one parent — concrete FKs, enforced by a CHECK (not polymorphic).
  companyId: text().references(() => companies.id, { onDelete: "cascade" }),
  contactId: text().references(() => contacts.id, { onDelete: "cascade" }),
  opportunityId: text().references(() => opportunities.id, { onDelete: "cascade" }),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  check("tasks_one_parent",
    sql`num_nonnulls(${t.companyId}, ${t.contactId}, ${t.opportunityId}) = 1`),
  index("tasks_contact_open_idx").on(t.contactId, t.done),
  index("tasks_opportunity_open_idx").on(t.opportunityId, t.done),
  index("tasks_company_open_idx").on(t.companyId, t.done),
]);

export type Task = InferSelectModel<typeof tasks>;
```

Three nullable concrete FK columns + a CHECK is the repo-idiomatic non-polymorphic way to
attach one row to one of several parents; it keeps real referential integrity and avoids
the three-near-identical-tables duplication the `*_entries` tables have.

Migration: `bun run db:generate` → **hand-edit the generated SQL** to `DELETE FROM
contact_entries WHERE kind = 'next_step';` (and the company/opportunity entries) *before*
the `kind` column/enum drop, so leftover next-step bodies don't resurface as notes → `bun
run db:migrate`. (DB is remote and always migrated; the seed wipes+reseeds anyway.)

## Remove next steps (collapse entries to notes-only)

Mechanical sweep — keep notes working, delete everything `next_step`:

- **Schema** — `src/lib/db/crm-schema.ts` (contactEntries, companyEntries) and
  `src/lib/db/opportunities-schema.ts` (opportunityEntries): drop the `kind` column and the
  `crmEntryKind` enum export; rebuild the `(parentId, kind, createdAt)` indexes as
  `(parentId, createdAt)`.
- **Schema module** — `src/actions/crm/entries.schema.ts`: delete `ENTRY_KINDS`,
  `entryKindSchema`, `EntryKind`, `NEXT_STEP_MAX_LENGTH`, `maxLengthForKind`,
  `refineEntryBody`. Add/update schemas become `{ parentId, body }` / `{ id, body }` capped
  at `NOTE_MAX_LENGTH`.
- **Mutations** — `src/actions/crm/entryMutations.ts` + the nine wrapper actions: drop the
  `kind` param.
- **Reads** — `src/actions/crm/entryViews.ts`: `toLogData` no longer splits by kind (returns
  notes only); `getOpportunity.ts` / `getContactDetail.ts` drop their `nextSteps` field.
  Delete `src/actions/shared/latestNextStep.ts`.
- **UI** — `src/components/crm/entry-log.tsx`: remove the `kind` prop, the `next_step` COPY,
  and the `Input` branch in `EntryInput` (always a `Textarea` now). Remove the `kind="next_step"`
  `<EntryLog>` sections from `opportunity-detail/sheet.tsx` and `contact-detail-view.tsx`
  (they're replaced by the Tasks card below). Delete `contact-next-step-cell.tsx`.
- **Seed** — `scripts/seed/entries.ts`: notes only (drop the `next_step` branch).

## Tasks feature

### Actions — `src/actions/crm/` (cohesive with entries; all gated `permission: { crm: ["edit"] }`)

Build on `secureActionClient`; resolve **creator** and the **default owner** from the
current user server-side via `resolveAuthorStaffId` / `getCurrentStaffAccess` — never trust a
client-supplied creator.

- `tasks.schema.ts` (pure, client-importable — hand-written `z.object`, reuse
  `@/lib/schemas/id-schema` + `requiredText`):
  - `taskParentSchema = z.discriminatedUnion("kind", [contact|company|opportunity × {id}])`
  - `createTaskSchema = { parent, description, ownerId?: id.nullable() }`
  - `updateTaskSchema = { id, description, ownerId?: id.nullable() }`
  - `setTaskDoneSchema = { id, done: boolean }`
  - `deleteTaskSchema = { id }`
  - export inferred `…Input` types.
- `createTask.ts` — mint `generateId("task")`, map `parent.kind` → the right FK column,
  `creatorStaffId = current`, `ownerStaffId = ownerId ?? current`, `revalidatePath`.
- `updateTask.ts` — edit description + owner.
- `setTaskDone.ts` — flip `done`; set `completedAt = new Date()` when true, `null` when false.
- `deleteTask.ts` — existence check → delete.
- `getTasks.ts` (`import "server-only"`) — `getTasksForParent(kind, id): TaskView[]`
  (`{ id, description, done, completedAt, createdAt, ownerId, ownerName, creatorName }`),
  ordered **open first, then newest**. Left-joins `staff` twice (owner + creator) for names.
- Current-owner default: add a tiny server-only `getCurrentStaffIdentity(): { id, name } | null`
  (reuse `getCurrentStaffId` + a staff name lookup) so detail pages can pass the default owner
  option into the composer.

### UI — `src/components/crm/task-list.tsx` (`<TaskList>`, modeled on `EntryLog`)

- Props: `variant: "contact" | "company" | "opportunity"`, `parentId`, `tasks: TaskView[]`,
  `canEdit`, `currentStaff: { id, name } | null`, `onChanged?`.
- **Composer** (when `canEdit`): a description `Textarea` + an owner `EntityCombobox`
  (`searchAction={searchStaff}`, prefilled with `currentStaff` as the default `EntityOption`)
  + "Add task" button → `createTask`.
- **List:** each row = a `Checkbox` (done toggle → `setTaskDone`), the description
  (struck-through when done), owner name, created date, and — when done — the completed date;
  hover reveals edit (description + owner) / delete, mirroring `EntryLog`'s inline pattern.
  Open tasks first, completed below.
- Add the shadcn `checkbox` primitive if absent (`bunx --bun shadcn@latest add checkbox`,
  then re-swap Lucide→Tabler per `.claude/rules/ui.md`).

### Detail-page cards

Add a `<DetailSection title="Tasks">` with `<TaskList>` (via `src/components/crm/detail-parts.tsx`)
where next steps used to render:
- `contact-detail-view.tsx` — replace the "Next steps" section.
- `opportunity-detail/sheet.tsx` — replace the "Next steps" section (pass `onChanged` so the
  client-fetched drawer reloads).
- `company-detail-view.tsx` — **add** a Tasks section (companies had no next-step section, only
  notes) for parity.

### Summary columns → "all incomplete tasks"

Replace the single-latest-next-step projection with the set of **open** tasks per parent.
Rather than a `DISTINCT ON` subquery, fetch open tasks for the page's parent ids in one query
and group in JS inside the read:

- `getContactsPage.ts` — attach `openTasks: { id, description }[]` per contact.
- `getOpportunitiesBoard.ts` — attach `openTasks` per opportunity.
- `getCompanyDetail.ts` — attach `openTasks` per contact in the company's contacts table.
- UI: `contacts-table.tsx` header "Next steps" → "Tasks", render a small stacked/clamped list;
  `opportunity-card.tsx` renders `openTasks`; `company-detail-view.tsx` contacts column likewise.

## Seed

`scripts/seed/tasks.ts` → `seedTasks(db, { companies, contacts, opportunities, staff })`:
build `InferInsertModel<typeof tasks>[]` with `generateId("task")` + faker, random owner/creator
from `staff`, a mix of done/open (set `completedAt` on done ones), each attached to one parent.
Wire it into `scripts/seed.ts` (after its parents), add `"tasks"` to `SEEDABLE_TABLES` in
`scripts/seed/wipe.ts`, and add a row-count line to the summary table.

## Permissions

No matrix change — every task mutation carries `metadata({ permission: { crm: ["edit"] } })`,
identical to the entries actions it replaces. Reads (`getTasks*`) stay open like other CRM reads.

## Docs

After implementation, dispatch the **librarian** subagent to reconcile `/docs`: update
`docs/domains/crm.md`, `docs/data-model.md`, mark **ADR 0030** (notes/next-steps entries) as
superseded for the next-step half, and add an ADR for the tasks entity + the entries→notes-only
collapse.

## Verification

- `bun run check` (Biome + `tsc` + matrix test) and `bun run build` — both green.
- `bun run db:generate` → hand-edit migration (delete `next_step` rows before the drop) →
  `bun run db:migrate` → `bun run db:seed` (must not error — seed imports the real tables).
- `/audit-rbac` — confirm every task mutation is gated and nothing bypasses `crm:edit`.
- Manual (via the `run` skill): open a **contact**, **company**, and **opportunity** detail →
  add a task (owner defaults to me), reassign owner via the picker, toggle done (completed date
  appears, description strikes through), edit + delete. Confirm the contacts table, company
  contacts table, and opportunity board card each list **all incomplete** tasks and drop the old
  "next steps" wording. Confirm **notes** still work everywhere.
