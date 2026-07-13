# Timesheets module

## Context

The PSA platform captures the plan (allocations) and the people (staff), but not the
**actuals** — what people actually worked on. Timesheets close that gap: they are the
basis for billing, utilization, and reconciling against allocations. `docs/domains/timesheets.md`
already sketches the intended model (status: *proposed*); no timesheet code exists yet.

This builds the **v1 slice** as a fresh domain: weekly time capture on a per-day grid,
capped at 8h/day total, with projects plus three non-billable buckets, a draft→submitted
lifecycle, and RBAC that lets people edit a ±1-week window of their own weeks while admins
edit anything.

### Decisions (confirmed with the user)

- **Daily cap** = total hours across all rows for a day must be ≤ 8 (not per-project).
- **Submit** flips a week `draft → submitted` (locks it); **no** manager approve/reject
  workflow in v1. A submitted week can be reopened (within the same edit rules).
- **Admin scope** = permission only. RBAC lets admins/managers edit *any* week; the v1 UI
  is each user's own timesheet with week navigation. No "edit someone else's" UI yet.
- **Edit window** (normal user): a week is editable/submittable only when it is within **±1
  week** of the current week (last week, this week, next week). "submit 1 week in advance"
  = next week; "edit 1 week ago" = last week. Anything outside requires the `timesheets.edit`
  capability (manager/admin).
- **Which projects can be logged?** Any *active* project (searchable), plus the non-billable
  buckets. (Resolves an open question in `docs/domains/timesheets.md`; we do **not** restrict
  to allocated projects in v1.)
- **PTO bucket** here is independent of the `staff_pto` table — just a non-billable category
  for logging hours; no sync in v1.

## Data model

New slice `src/lib/db/timesheets-schema.ts`, re-exported from the `src/lib/db/schema.ts`
barrel (`export * from "./timesheets-schema"`). Follows all `.claude/rules/database.md`
conventions: camelCase keys (snake_case derived), `generateId(prefix)` CUID2 ids minted
before insert, `date()` string-mode for calendar dates, standard `timestamp()` pairs,
`InferSelectModel` row types, FK-only (no drizzle `relations()`).

**Shared enum module** `src/lib/timesheet-category.ts` (pure, client-importable — mirrors
`src/lib/line-of-business.ts`): the non-billable categories as a source of truth for the
pgEnum, zod, and UI labels.

```ts
export const TIMESHEET_CATEGORY = ["PTO", "UNALLOCATED_BENCH", "INTERNAL_ADMIN"] as const;
export const TIMESHEET_CATEGORY_LABELS = {
  PTO: "PTO", UNALLOCATED_BENCH: "Unallocated Bench Time", INTERNAL_ADMIN: "Internal Admin Work",
};
```

**Tables:**

- `timesheets` (id prefix `ts`): `staffId` → `staff.id` (cascade), `weekStartDate` date
  (Monday), `status` `timesheetStatusEnum` (`["draft","submitted"]`, default `draft`),
  `submittedAt` timestamp nullable, timestamps. **Unique(`staffId`, `weekStartDate`)**;
  index on `staffId`. One row per person per week; created lazily on first save.
- `time_entries` (id prefix `te`): `timesheetId` → `timesheets.id` (cascade), `date` date,
  `projectId` → `projects.id` (restrict, **nullable**), `category` `timeEntryCategoryEnum`
  (from the shared module, **nullable**), `hours` `numeric({precision:4,scale:2,mode:"number"})`,
  timestamps. Index on `timesheetId`. **Invariant: exactly one of `projectId`/`category` set**
  — enforced in the action (and a table CHECK constraint via `sql` for defense-in-depth).

Row types: `export type Timesheet = InferSelectModel<typeof timesheets>` etc.

**Week math helper** `src/lib/timesheet-week.ts` (pure module — no date library exists in the
repo, dates are timezone-agnostic `"YYYY-MM-DD"` strings): `getWeekStart(date)` (ISO Monday),
`addWeeks(weekStart, n)`, `getWeekDays(weekStart)` → 7 date strings, `currentWeekStart()`,
`weeksBetween(a, b)`, `isWithinEditWindow(weekStart)` → `Math.abs(weeksBetween(currentWeekStart(), weekStart)) <= 1`.
Parse using the local-midnight trick already in `src/lib/format.ts:formatDate` to avoid UTC drift.

## Permissions (RBAC)

Follows `.claude/rules/permissions.md` and the `canEditStaff`/`authorizeStaffEdit` pattern
exactly. Keep the three in lockstep.

1. **`src/lib/permissions.ts`** — add `timesheets: ["edit"]` to `statement` (capability =
   "edit any timesheet, bypassing owner + window"). Grant it in the `roles` map to `manager`
   and `admin` (the roles that already hold every business-edit cap).
2. **`src/lib/permissions.test.ts`** — add the matrix assertions for the new capability.
3. **`docs/domains/permissions.md`** — add the `timesheets.edit` row to the matrix table.
4. **`src/actions/timesheets/canEditTimesheet.ts`** (server-only) — mirrors `canEditStaff.ts`:
   - `canEditTimesheet(user, { staffId, weekStartDate }): Promise<boolean>` — `true` if
     `userHasPermission(user, { timesheets: ["edit"] })`; else the target `staffId` must be the
     caller's own staff record (`staff.userId === user.id`) **and** `isWithinEditWindow(weekStartDate)`.
   - `authorizeTimesheetEdit: ActionAuthorize` — reads `clientInput.staffId` + `clientInput.weekStartDate`,
     throws `UserSafeActionError` when `canEditTimesheet` is false. Wired via `.metadata({ authorize })`.
   - The owner path needs **no** permission (consistent with staff/PTO "own vs other" semantics).

## Server actions & reads

New domain folder `src/actions/timesheets/`. All DB access lives here (`.claude/rules/server-actions.md`).

**Reads** (plain `import "server-only"` `get*.ts`, self-scoped by ownership, explicit columns):

- `getTimesheet.ts` — for a `staffId` + `weekStartDate`, return `{ timesheet | null, entries[] }`.
  Self-scoped: own record always; another's only when `userHasPermission(user, { timesheets: ["edit"] })`,
  else `null`. Returns entries with joined project name/company for display (manual join, no N+1).
- `getSelectableProjects.ts` — `{ id, name, companyName }[]` of active projects for the row
  picker combobox (explicit columns; reuse the projects list query shape if one exists).

**Mutations** (one action per file, `secureActionClient`, `.inputSchema`, drizzle-zod where
possible, `authorize: authorizeTimesheetEdit`, `revalidatePath("/timesheets")`):

- `saveTimesheet.ts` — input `{ staffId, weekStartDate, entries: { date, projectId?, category?, hours }[] }`.
  Upserts the `timesheets` row (create as `draft` if absent), then **transactionally replaces**
  all `time_entries` for that timesheet (delete-all + insert) — simplest correct model for
  whole-week editing. Server-side validation (also mirrored client-side): every entry date is
  one of the week's 7 days; `hours >= 0`; **per-day total across all entries ≤ 8**; exactly one
  of `projectId`/`category`; at most one row per (date, target). Refuses to write a `submitted`
  week unless it is reopened first (or caller holds `timesheets.edit`).
- `submitTimesheet.ts` — input `{ staffId, weekStartDate }`; set `status="submitted"`, stamp
  `submittedAt`.
- `reopenTimesheet.ts` — input `{ staffId, weekStartDate }`; set `status="draft"`, clear
  `submittedAt` (lets the owner edit a submitted week again within the window; admins any).

Shared zod schemas in sibling `*.schema.ts` files (client imports them for the resolver).

## UI

- **Nav** — add `{ title: "Timesheets", href: "/timesheets", icon: IconClock }` to `NAV_ITEMS`
  in `src/components/app-shell/nav.ts` (`@tabler/icons-react`).
- **Page** `src/app/(app)/timesheets/page.tsx` (async Server Component): resolve current staff
  (`getCurrentStaff`), read `?week=YYYY-MM-DD` (default `currentWeekStart()`), `Promise.all`
  of `getTimesheet` + `getSelectableProjects` + `getCurrentUser`, compute `canEdit`
  (`canEditTimesheet`) and pass everything to the client component. Export `metadata`.
- **Client grid** `src/components/timesheets/timesheet-week.tsx`:
  - Week navigation: prev / next / "This week" (updates the `?week=` param); a `Badge` showing
    Draft/Submitted status and the week range.
  - Weekly grid built on the vendored `table` primitive (reference `src/components/admin/editable-table.tsx`
    for the inline-edit idiom, but purpose-built): rows = chosen projects + non-billable buckets,
    columns = Mon–Sun numeric `Input`s, a trailing per-row total, `IconButton` to remove a row.
    Footer row shows **per-day totals** (turn destructive when a day > 8) and the week total.
  - "Add row" via a `Combobox` listing active projects + the 3 category buckets (excluding rows
    already added). Uses `useZodForm`/`useForm` + `useAction` (form (b), since the grid shape ≠
    action input); client-side `safeParse` + `applyServerIssues` before `execute`, per
    `.claude/rules/forms.md`.
  - **Save** and **Submit** buttons (loading from `isPending`; errors from `result.serverError`;
    `sonner` toast on success). When the week is outside the edit window (and user lacks the
    capability) or already submitted, render **read-only** with a Reopen button where allowed.

## Docs (after implementation)

Dispatch the **librarian** subagent to reconcile `/docs`: flip `docs/domains/timesheets.md`
status *proposed → built* and document the realized model + the resolved open questions;
update `docs/data-model.md` (mark `Person ──< TimeEntry >── Project` built); confirm the
`timesheets.edit` row in `docs/domains/permissions.md`; add an ADR capturing the model choices
(per-day entries, whole-week transactional replace, ±1-week window, non-allocated logging allowed,
PTO bucket independent of `staff_pto`).

## Verification

1. **Migrate:** `bun run db:generate` → `bun run db:migrate`.
2. **Pre-flight:** `bun run check` (Biome + `tsc` + `bun test`, incl. the permissions matrix test)
   and `bun run build`.
3. **RBAC:** run `/audit-rbac` and address findings.
4. **Drive the app** (`bun run dev`) end-to-end and observe behavior:
   - Log hours across a project + a non-billable bucket for the current week; confirm the per-day
     total blocks saving when a day exceeds 8h.
   - Save (draft) → Submit → confirm it locks and shows Submitted; Reopen → edit again.
   - Navigate to last week (editable), next week (submittable in advance), and **two weeks ago**
     (read-only for a normal user — the window boundary).
   - As an admin, confirm editing a week outside the window is allowed.
   - Verify a non-admin cannot read/write another person's timesheet (server gate, not just UI).

## Key files

- Create: `src/lib/db/timesheets-schema.ts`, `src/lib/timesheet-category.ts`,
  `src/lib/timesheet-week.ts`, `src/actions/timesheets/*` (reads + mutations + `canEditTimesheet.ts`),
  `src/app/(app)/timesheets/page.tsx`, `src/components/timesheets/timesheet-week.tsx`.
- Modify: `src/lib/db/schema.ts` (barrel), `src/lib/permissions.ts`, `src/lib/permissions.test.ts`,
  `src/components/app-shell/nav.ts`, `docs/domains/permissions.md`.
- Model after: `src/lib/db/staff-schema.ts` (enums/numeric/dates), `src/actions/crm/createCompany.ts`
  (action shape), `src/actions/staff/canEditStaff.ts` (ownership authorize), `src/actions/staff/getStaffPto.ts`
  (self-scoped read), `src/components/projects/add-project-dialog.tsx` (field-array form),
  `src/components/admin/editable-table.tsx` (inline-edit grid).
