# Compensation change plans

## Context

Performance management today has two disconnected halves: the `/performance` dashboard
(anonymised aggregate compensation + level distribution) and `/performance/levels/edit`
(a bulk grid for assigning L0–L4 levels and per-role subratings). Neither supports the
actual **comp review cycle** — the recurring exercise where a manager takes a cohort of
staff, evaluates each, agrees a compensation change, tracks the conversation, and lands
the result.

This adds that: a **compensation change plan** — a named, effective-dated proposal
covering a set of staff, with a per-person editor tracking rating, proposed
compensation, workflow checkboxes and notes, and a **commit** step that lands the
ratings as each person's latest rating.

### Decisions locked in before writing this

1. **Commit writes ratings only.** ADR 0020 makes Rippling the sole writer of
   `staff_employment`; committing a plan does **not** mutate compensation. The planned
   comp stays a proposal. ADR 0020 is preserved, not superseded.
2. **Committed plans surface drift.** Once committed, the editor keeps reading each
   person's *live* comp from Rippling and highlights any row where actual ≠ planned —
   so you can see at a glance which changes have and haven't been applied upstream.
3. **Planned comp is one amount + currency**, mapping to `base` for `FULL_TIME` staff
   and `hourlyRate` for `HOURLY`. Bonuses are untouched.
4. **No permission-matrix change.** Every surface requires **both**
   `staff.viewCompensation` **and** `ratings.edit` — effectively manager/admin. Verified
   that Better Auth's `authorize` ANDs multiple resources
   (`node_modules/better-auth/dist/plugins/access/access.mjs:47`), so one
   `metadata.permission: { staff: ["viewCompensation"], ratings: ["edit"] }` is a real
   conjunction and `finance` (comp-only) is correctly denied.
5. **Current comp is live while drafting**, snapshotted into the item at commit so a
   committed plan shows a stable before/after forever.

### Convention this feature deliberately breaks

Both existing performance reads (`getCompensationSummaryData`, `getRatingsSummaryData`)
return **identity-free rows** — no id, no name — because an aggregate comp view is bulk
exposure. A comp plan is inherently per-person and named. That is a real change in
posture and must be documented in `docs/domains/permissions.md`: the anonymisation
discipline applies to the *aggregate dashboard*, while the plan surface is
identity-bearing and therefore carries the stricter combined gate.

---

## Data model

Add to `src/lib/db/performance-schema.ts` (same domain, same file — mirrors how
`staff_rating` sits beside `feedback`).

New pure module `src/lib/performance/compensation-plan.ts` owns the status tuple, per
the shared-enum convention (ADR 0016) used by `src/lib/format/currency.ts`:

```ts
export const COMPENSATION_PLAN_STATUSES = ["DRAFT", "COMMITTED"] as const;
export type CompensationPlanStatus = (typeof COMPENSATION_PLAN_STATUSES)[number];
```

### `compensation_plan`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `generateId("cplan")` |
| `name` | text notNull | e.g. "H2 2026 review" |
| `status` | enum notNull default `DRAFT` | |
| `effectiveDate` | `date()` string mode notNull | the date committed ratings are dated |
| `createdByUserId` | text → `user.id` `set null` | audit |
| `committedAt` | timestamp | null while draft; doubles as the idempotency guard |
| `committedByUserId` | text → `user.id` `set null` | audit |
| `createdAt` / `updatedAt` | timestamp | `$onUpdate` on the latter |

### `compensation_plan_item`

One row per staff member in the plan.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `generateId("cplanitem")` |
| `planId` | text notNull → `compensation_plan.id` **cascade** | item is meaningless without the plan |
| `staffId` | text notNull → `staff.id` **cascade** | matches `staff_rating` |
| `level` | integer | proposed L0–L4, nullable = unrated; same CHECK as `staff_rating` |
| `subratings` | `jsonb().$type<Subratings>()` | proposed per-role subratings |
| `plannedAmount` | `numeric({precision:12,scale:2,mode:"number"})` | nullable until entered |
| `plannedCurrency` | `currencyEnum()` | nullable until entered; may differ from current |
| `ratingDone` / `meetingDone` / `isComplete` | boolean notNull default false | workflow tracking, independent of content |
| `evaluationNotes` / `compensationNotes` | text | the two textareas |
| `snapshotAmount` | numeric(12,2) | frozen at commit: base or hourly rate at that moment |
| `snapshotCurrency` | `currencyEnum()` | frozen at commit |
| `snapshotEmploymentType` | `employmentTypeEnum()` | frozen at commit — records *which* field `plannedAmount` was compared against |
| `createdAt` / `updatedAt` | timestamp | |

Constraints: `uniqueIndex` on `(planId, staffId)` (one item per person per plan),
`index` on `planId`, and the level-range CHECK copied from `staff_rating`.

The three `snapshot*` columns are null while the plan is a draft and written in the
commit transaction. `snapshotEmploymentType` matters because it disambiguates an
annual base from an hourly rate years later, when the person may have switched.

`bun run db:generate` → `bun run db:migrate`, then update the seed: a
`seedCompensationPlans(db, staff)` export in `scripts/seed/performance.ts` producing one
draft and one committed plan, wired into the seed entrypoint, and the two new tables
added to `scripts/seed/wipe.ts`. The seed imports the real Drizzle tables, so leaving it
stale shows up as a `bun run check` failure.

---

## Pure logic — `src/lib/performance/compensation-plan.ts`

Alongside the status tuple:

```ts
/** Months since a date, or null when unknown. Drives the tenure chip. */
export function tenureMonths(joinDate: string | null, today: Date): number | null

/** Change math in a chosen display currency. Every field nullable — never NaN. */
export function planChange(args: {
  currentAmount: number | null;  currentCurrency: Currency | null;
  plannedAmount: number | null;  plannedCurrency: Currency | null;
  displayCurrency: Currency;     usdRates: UsdRates;
}): { current: number | null; planned: number | null;
      changeAmount: number | null; changePercent: number | null }
```

Both legs are converted into `displayCurrency` with `convert()` from
`src/lib/format/fx.ts` before subtracting, which is what makes a cross-currency change
(e.g. CAD → USD promotion) meaningful. `changePercent` is null when `current` is null or
zero — rendered as an em dash, matching the dashboard's "empty group → `—`, never NaN"
convention.

**One test file** (`compensation-plan.test.ts`) asserting the invariant types can't
express: `changePercent` is *identical* across all three display modes, and every
null/zero path yields `null` rather than `NaN`/`Infinity`. ADR 0037 says don't
reflexively add tests; this is offered as the "genuinely beyond the type checker"
exception it carves out, alongside `rating-stats.test.ts` in the same folder.

---

## Actions — `src/actions/performance/`

Every action below carries
`metadata.permission: { staff: ["viewCompensation"], ratings: ["edit"] }`.

### Reads (server-only, `get*.ts`)

- **`getCompensationPlans.ts`** — list rows: id, name, status, effective date, staff
  count, committed-at.
- **`getCompensationPlanCandidates.ts`** — every active staff member with the four
  filter dimensions (name, `lineOfBusiness`, `role`, `employmentType`) plus `location`,
  and an `alreadyInPlan` flag when a `planId` is supplied. Returns the full active roster
  in one read (hundreds of rows) so the picker filters client-side, matching
  `src/components/timesheets/add-project-dialog.tsx` rather than a debounced server
  search.
- **`getCompensationPlan.ts`** — the editor payload. Query plan, avoiding N+1:
  1. plan header;
  2. items joined to `staff` (name, location, joinDate);
  3. **all** `staff_employment` rows for the item staff, ordered by
     `latestEmploymentFirst` (`src/lib/staff/staff-employment.ts`) — then
     `firstPerKey` (`src/lib/core/collections.ts`) for the current row, and a second
     pass for the *previous* row per staff to compute their last comp change;
  4. **all** `staff_rating` rows for those staff ordered by `latestRatingFirst`
     (`src/lib/staff/staff-rating-history.ts`) — `firstPerKey` for the latest, second
     pass for the prior one.

  This is the established pattern in `getCompensationSummaryData.ts` and
  `getAllocationsGrid.ts`; four queries total, no window functions needed at this row
  count. A committed plan returns **both** the frozen snapshot and the live current comp
  so the UI can flag drift.

### Mutations (one per file)

| File | Input | Behaviour |
|---|---|---|
| `createCompensationPlan.ts` | `{ name, effectiveDate, staffIds[] }` | Creates plan + items. **Prefills each item's `level` and `subratings` from that person's latest rating**, sanitised to their current role's rubric. |
| `addCompensationPlanStaff.ts` | `{ planId, staffIds[] }` | Same prefill; `onConflictDoNothing` on the unique index. Draft only. |
| `removeCompensationPlanStaff.ts` | `{ planId, staffIds[] }` | Draft only. |
| `updateCompensationPlan.ts` | `{ planId, name?, effectiveDate? }` | Draft only. |
| `deleteCompensationPlan.ts` | `{ planId }` | Cascades items. |
| `saveCompensationPlanItem.ts` | `{ itemId, patch }` | **The autosave endpoint.** See below. |
| `commitCompensationPlan.ts` | `{ planId }` | See below. |

**`saveCompensationPlanItem`** takes one optional-field patch covering every editable
field (`level`, `subratings`, `plannedAmount`, `plannedCurrency`, the three booleans,
the two note fields). One action rather than nine: the autosave hook already serialises
writes, a single endpoint keeps the drain loop trivial, and partial-patch semantics let
a field save without clobbering its neighbours. It re-reads the item's plan to reject
any write to a `COMMITTED` plan (`UserSafeActionError`), and runs `subratings` through
the same `sanitizeSubratings` logic as `saveStaffEvaluation.ts` against the staff
member's **current** role. It does **not** `revalidatePath` — that would fight the
autosave; the client owns its own state and refreshes on navigation.

**`commitCompensationPlan`** — modelled directly on
`src/actions/performance/saveStaffEvaluation.ts`, which is the hardened template:

1. Re-read the plan; if already `COMMITTED`, throw (idempotency guard on `committedAt`).
2. Re-read items, target staff (skip inactive/unknown), their latest ratings and latest
   employment rows.
3. For each item, `sanitizeSubratings` against the person's current role, then drop
   no-ops using `canonicalSubratings` — an item whose level *and* subratings match the
   person's current rating produces no new row.
4. Reject the whole commit if `plan.effectiveDate` is earlier than any target's latest
   rating date, naming the offenders (the plan date is editable, so this is fixable) —
   equal dates are fine, `createdAt` breaks the tie.
5. In one transaction: insert the surviving `staff_rating` rows
   (`evaluatedByUserId = ctx.user.id`, `effectiveDate = plan.effectiveDate`), write each
   item's `snapshot*` columns from its current employment row, and set
   `status = "COMMITTED"`, `committedAt`, `committedByUserId`.
6. `revalidatePath("/performance")` (level distribution changes) and the plan routes.

Items with no rating and no planned amount are left alone — they still get their
snapshot so the record is complete.

**The comp-write seam.** Step 5's rating insert and the (currently absent)
`staff_employment` insert are separated into two private helpers in the action file, so
turning on in-app comp writes later is a one-function change plus an ADR — no schema
reshaping. It stays off.

---

## Routes & navigation

- `src/app/(app)/performance/compensation-plans/page.tsx` — plan list + "New plan".
- `src/app/(app)/performance/compensation-plans/[planId]/page.tsx` — the editor.

Both are Server Components following `src/app/(app)/performance/page.tsx`: resolve
`getCurrentUser()`, `notFound()` unless
`userHasPermission(user, { staff: ["viewCompensation"], ratings: ["edit"] })`, then
`Promise.all` the reads (including `getExchangeRates()`), and set `export const metadata`
plus their own `<h2 className="font-heading text-2xl font-semibold tracking-tight">`.

Nav: add a third `NavSubItem` to the Performance entry in
`src/components/app-shell/nav.ts` — "Compensation plans" →
`/performance/compensation-plans`, with the same combined `permission`.

---

## UI — `src/components/performance/compensation-plan/`

| File | Responsibility |
|---|---|
| `plan-list.tsx` | Table of plans + status badge + row link. |
| `create-plan-dialog.tsx` | `FormDialog` — name, effective date (`date-picker`, `"YYYY-MM-DD"`), then the staff picker. Tight binding via `useHookFormAction`. |
| `staff-picker.tsx` | The searchable, filterable, checkbox roster. Reused by create and by "Add staff" on an existing plan. |
| `plan-editor.tsx` | Client root: owns display-currency state, expanded-row set, and the autosave hook. |
| `plan-editor-row.tsx` | One `<TableRow>` + its expanded panel row. |
| `plan-expanded-panel.tsx` | Tenure/last-rating/last-change stats, subrating selects, two textareas. |
| `money-input.tsx` | Amount `<Input type="number" inputMode="decimal">` + currency `<Select>` inside `InputGroup`. First money input in the app. |
| `display-currency-toggle.tsx` | `SegmentedFilter`-style Default / CAD / USD. |
| `commit-plan-dialog.tsx` | Confirm dialog summarising what will be written. |

### The table: build bespoke, don't extend `EditableTable`

`src/components/admin/editable-table.tsx` is a **draft-then-confirm batch engine** —
local drafts, a floating "N changed" bar, a diff dialog. That is the opposite of
save-on-edit, and it has no row expansion (nothing in the app does). Bending it would
either fork it or degrade its three existing consumers.

Build the editor on the shadcn `Table` primitives directly, with expansion as a
`Set<string>` of item ids in the parent — the same self-managed-selection idiom as
`selectedRoleIds` in `src/components/projects/opportunity-plan/planner-grid.tsx`, which
is itself precedent for "complex grids hand-roll the table". An expanded row renders a
second `<TableRow>` whose single `<TableCell colSpan={n}>` holds the panel. No TanStack
needed; name sorting is a local `useMemo`.

### Autosave

Extract the drain engine currently inside
`src/components/staff/use-response-autosave.ts` into a generic
`src/hooks/use-autosave-queue.ts`: a dirty-set of keys, a single-flight drain loop,
per-key debounce timers, per-key `SaveState`, `flushKey` / `flushAll`, parameterised by
a `save(key) => Promise<boolean>` callback. Then refactor `use-response-autosave.ts` to
sit on it (behaviour unchanged) and build `use-plan-autosave.ts` on it too. That hook's
docblock already describes exactly the semantics we need — re-queue on mid-save edits,
never show a stale ✓ — and duplicating ~150 lines of it would be the wrong call.

Keys are `` `${itemId}:${field}` ``. Text and number fields debounce at 600 ms;
checkboxes and selects save immediately (`{ immediate: true }`). `flushAll` runs on
unmount and before navigation, and on collapsing an expanded row so the textareas
land. A small save-state indicator sits in the plan header (idle / "Saving…" / "Saved" /
"Couldn't save"), modelled on
`src/components/staff/response-save-indicator.tsx` — one indicator for the whole plan
rather than per cell, which would be visual noise across nine columns.

### Display currency

State is `"DEFAULT" | "CAD" | "USD"`. Per row, the **target** currency is the row's own
`currentCurrency` under `DEFAULT`, otherwise the chosen one.

- **Current** — `convert(current, currentCurrency, target)`, shown via `formatMoney`.
- **Planned** — always *edited* in its own `plannedCurrency` (the input carries its own
  currency select). Converting an editable field would round-trip and lose precision.
  When `plannedCurrency ≠ target`, a muted converted value renders beneath the input.
- **Change $** — `convert(planned, plannedCurrency, target) − convert(current, currentCurrency, target)`.
- **Change %** — the same two converted legs. Because both convert through the same rate
  table, the percentage is **identical in all three display modes** — which is the
  correct behaviour and the invariant the test pins.
- Null current, zero current, or missing planned → `—`.
- The stale-FX banner reuses the dashboard's copy when `getExchangeRates()` returns
  `stale: true`.

### Columns

Name (with line of business · role · employment type · location as a muted sub-line) ·
Rating select · Current · Planned · Change $ · Change % · Rating done · Meeting done ·
Complete · expand chevron. Numeric cells carry `tabular-nums`.

### Expanded panel

Flat, hairline-bordered, no shadow, indigo only on focus rings:

- A stats strip — **Joined** (`formatDate`) with a `<Badge>` reading "7 months" when
  `tenureMonths < 12`; **Last evaluation** (`formatLevel`, with its effective date);
  **Last change** ("+$8,000 · +6.2%" from the previous two employment rows, `—` if
  there's only one).
- **Subratings** — one `<Select>` per category from `rubricForRole(role)`, options
  `SUBRATING_LEVELS` (1–4) plus `UNRATED_SELECT_VALUE`. Roles without a rubric (only
  `ENGINEER` has one today) render a muted "No rubric for this role yet."
- Two `<Textarea>`s: **Evaluation notes** and **Compensation update notes**.

### Committed plans

Read-only: inputs become text, checkboxes disable, an alert notes the plan was committed
on *date* by *person*. Current/Change columns render from the frozen `snapshot*` values.
An extra **Applied** column compares the person's *live* comp against
`plannedAmount` (converted) and shows a muted "Applied" or a warning-toned "Not applied —
now $X" badge. That's the Rippling-drift highlight.

### Staff picker

Client-side over the preloaded roster: a search `<Input>` with `IconSearch` matching
name (the `matches()` idiom in `add-project-dialog.tsx`), plus `SelectFilter`s for line
of business, role and employment type from `STAFF_FILTER_OPTIONS`
(`src/lib/staff/staff-filters.ts`) using the `ALL` sentinel. A scrolling
`max-h-80 overflow-y-auto` list of `<Checkbox>` rows showing name + dimensions +
location, a "Select all N filtered" control, and a live "N selected" count. Staff already
in the plan render checked and disabled.

### Edge cases

Staff with no employment row (current comp `—`, change `—`, still ratable); no prior
rating (select defaults to "Unrated"); no rubric; hourly staff (the Current/Planned
columns label as a rate — `snapshotEmploymentType` records which); a plan whose staff
member is deactivated after being added (shown muted, skipped at commit); stale FX.

---

## Docs

Dispatch the `librarian` subagent afterwards with a summary. It should cover:

- `docs/domains/performance.md` — the new plan surface and its lifecycle.
- `docs/data-model.md` — the two new tables.
- `docs/domains/permissions.md` — the combined gate, and the explicit note that this
  surface is identity-bearing by design while the aggregate dashboard stays anonymised.
- A new ADR — *compensation change plans are rating-writing proposals* — recording that
  commit deliberately does **not** write `staff_employment`, that ADR 0020 stands, and
  that committed plans surface drift against Rippling instead. It should reference ADR
  0020, 0007, 0032, 0042.
- `docs/flows.md` — the comp review cycle as a cross-domain flow.

---

## Verification

1. `bun run db:generate` && `bun run db:migrate`, then `bun run db:seed` — the seed must
   produce a draft and a committed plan without error.
2. `bun run check` (Biome + `tsc --noEmit` + `bun test`) and `bun run build`.
3. `bun run dev`, signed in as a manager:
   - `/performance/compensation-plans` is reachable and appears in the nav.
   - Create a plan; the picker filters by name, line of business, role and employment
     type, and select-all respects the active filter.
   - In the editor, confirm the rating select is prefilled from the last rating.
   - Edit a planned amount → the save indicator cycles to "Saved"; hard-refresh and
     confirm it persisted. Toggle each checkbox and confirm immediate save.
   - Set a planned currency different from the current currency and check Change $/%
     against a hand calculation; switch Default → CAD → USD and confirm **Change % is
     unchanged** while Current and Change $ re-denominate.
   - Expand a row: tenure chip shows only for <12 months; last change matches the two
     most recent employment rows; subrating selects appear only for `ENGINEER`; both
     textareas autosave on blur and on collapse.
   - Commit; confirm the plan locks read-only, and that `/performance` and
     `/performance/levels/edit` now show the new levels. Confirm the drift column reads
     "Not applied" since Rippling hasn't moved.
   - Re-committing is rejected.
4. **Permissions** — sign in as `finance` (has `staff.viewCompensation`, not
   `ratings.edit`): the nav item is hidden and both routes 404. As `user`: same. Then run
   `/audit-rbac`.
5. `/code-review` and `/security-review` before merging.
