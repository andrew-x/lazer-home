# Delivery managers become ordinary `DELIVERY` roles

## Context

`project_delivery_managers` is a dateless, moneyless junction table (`{projectId, staffId}`) that
duplicates a capability `project_roles` already has: `roleType = "DELIVERY"` exists in the pgEnum
and is already selectable in every role dialog. Because the junction has no dates, it can answer
"who runs this project" but never "who runs it *in March*" — so a project can lose delivery
coverage mid-flight and nothing notices.

Collapsing the junction into `project_roles` turns a stored fact into a derived one, exactly the
move `projects` already made for status, line of business and health. It also unlocks the thing
the junction structurally couldn't have: **a coverage gap**. That gap detector is the "exception"
in "treated the same as all the other roles with an exception".

Outcome: a delivery manager is a dated, statused, priced role like any other; the project view
warns when any working period of the plan has no delivery manager on it; the sidebar still names
the delivery managers (now derived, read-only); and the projects-list `dm` filter keeps working.

## Decisions locked with the user

1. **An open (unstaffed) `DELIVERY` role is still a gap.** Coverage requires a named `staffId` —
   "no period without a delivery manager" read literally.
2. **Any uncovered weekday warns — no minimum-gap threshold.** Weekends are never gap days, so a
   role ending Friday and its successor starting Monday is contiguous.
3. **Plain `DROP TABLE`, no backfill.** Reseed regenerates `DELIVERY` roles.
4. **Delivery time counts toward money and capacity like any other role.** A `DELIVERY` role
   carries `hoursPerDay` and `billRate > 0`, so it flows into plan revenue/cost/margin, the
   planner's capacity meter, and the utilization report's *Planned* series. Seed gives them
   1–2h/day so a DM doesn't read as full-time on three projects at once.

## Recommendations (not yet confirmed — say so if you disagree)

- **Symmetric non-cancelled predicate on both sides.** The window to cover is min/max over
  non-cancelled, **non-`DELIVERY`** roles (a DM tail wrapping up past the last engineer must not
  widen the window it then trivially covers; a project of only `DELIVERY` roles has nothing to
  manage). Coverage comes from non-cancelled `DELIVERY` roles with a named person. One rule,
  statable in a sentence. Note this deliberately follows neither existing precedent —
  confirmed-only (utilization report) would light up every tentative plan as 100% uncovered at
  the moment nothing is real yet.
- **Sidebar field becomes read-only derived**, mirroring "Line of business" directly above it.
- **No notice on the opportunity drawer's Project-plan tab** — pre-sale plans are all-tentative
  and deliberately unstaffed, so it would fire on nearly every opportunity.
- **Add a `noDeliveryManager` projects-list flag** (free — the role rows are already fetched).

## Risks worth naming

- With no minimum threshold, a role typed one weekday short of its successor produces a real
  warning. The module is structured so adding a `MIN_DELIVERY_GAP_WEEKDAYS` filter is a one-line
  change at the end of `deliveryCoverageGaps`.
- Decision 4 moves plan revenue and margin on every project that gains a `DELIVERY` role, and
  moves every DM's utilization figure. Expected, but it will look like a regression on first view.

---

## Step 1 — the pure module

**New `src/lib/projects/delivery-coverage.ts`** — pure, client-importable (no `db`, no React),
beside `project-derived.ts` / `project-flags.ts` and in `project-flags.ts`'s house style (named
constants with rationale, a `DELIVERY_COVERAGE_REVIEWED_ON` stamp, no clock reads inside).

```ts
type DeliveryCoverageRole = {
  roleType: ProjectRoleType;
  status: ProjectRoleStatus;
  staffId: string | null;
  staffName: string | null;
  startDate: string; // "YYYY-MM-DD", inclusive
  endDate: string;   // inclusive
};
type DeliveryCoverageGap = { startDate: string; endDate: string; weekdays: number };
```

Structurally satisfied as-is by `PlanRole` (verified: it carries `staffId` *and* `staffName`) and
by `getProjectsList`'s `roleRows` once a `staffName` leftJoin is added — no caller reshapes
anything.

Exports:

- `isDeliveryCoverage(role)` — `roleType === "DELIVERY" && status !== "cancelled" && staffId !== null`.
- `needsDeliveryCoverage(role)` — `roleType !== "DELIVERY" && status !== "cancelled"`. Reuse
  `countsTowardBudget` from `project-margin.ts` for the status half rather than a fourth copy of
  `status !== "cancelled"`.
- `deliveryCoverageGaps(roles)` — the algorithm below.
- `deliveryManagersOf(roles)` — distinct `{id, name, spans}` over `isDeliveryCoverage` roles,
  name-ordered. The single definition of "delivery manager" that the sidebar, the list column and
  the `dm` filter all consume.

Algorithm — reuse `rangeOf` from `plan-summary.ts` for the window, `addDays`/`isWeekend` from
`timesheets/timesheet-week.ts` for the scan:

```
window = rangeOf(roles.filter(needsDeliveryCoverage));  if (!window) return []
covering = roles.filter(isDeliveryCoverage)
run = null; gaps = []
for (day = window.start; day <= window.end; day = addDays(day, 1)):
    if (isWeekend(day)) continue                 // weekends are never gap days…
    if (covering.some(r => day >= r.startDate && day <= r.endDate)):
        flush(run); run = null                   // …and only a COVERED WEEKDAY closes a run
    else:
        run = run ? {...run, endDate: day, weekdays: run.weekdays + 1}
                  : {startDate: day, endDate: day, weekdays: 1}
flush(run); return gaps
```

The `continue` is the whole weekend story and needs spelling out in the module comment — it is the
bug a reader will look for. A Saturday is neither added to a run nor allowed to end one, so a Fri→Mon
handover yields no gap, and a gap can never start or end on a weekend (so `formatDateRange` always
names working days).

Do **not** lift the private `spansOverlap` copies (`utilization-report.ts:385`,
`availability.ts:299`) — day-containment is a different shape, so this would be a third *caller*,
not a third copy. That cleanup belongs in its own change.

Complexity: O(window days × covering roles) ≈ 1,500 comparisons per project; 20-row page ≈ 30k.
`assembleRows` already runs `roleBillableHours`' day-by-day count twice per role per project, so
day iteration is this file's established cost profile. Note the merge-intervals alternative in a
comment and move on.

**New `src/lib/projects/delivery-coverage.test.ts`** — `project-flags.test.ts` style, fixed Monday
anchor (`2026-03-02`) so weekday arithmetic reads. Cases: no roles → `[]`; only `DELIVERY` roles →
`[]`; full-span cover → `[]`; front-half cover → one gap with exact dates (start = next weekday
after the DM ends); **Fri→Mon seam → `[]`**; Fri→Tue seam → one 1-weekday gap; cancelled `DELIVERY`
role does not cover; cancelled non-`DELIVERY` role does not widen the window; **tentative DM covers
a confirmed engineering span** (asserted on purpose — the judgement call); **open (`staffId: null`)
`DELIVERY` role does not cover** (asserted on purpose — decision 1); one covered weekday between
two stretches splits into two chronological gaps; window starting Saturday → gap starts Monday;
window entirely inside a weekend → `[]`; overlapping DMs → no phantom gap; roles supplied out of
order → same result.

**Edit `src/lib/projects/project-role-type.ts`** — its doc comment (L51-54) currently *documents the
very distinction being deleted* ("a delivery role on a plan … is a different thing from
`project_delivery_managers`"). Replace with: a delivery manager **is** a `DELIVERY` role — dated,
priced, statused — pointing at `delivery-coverage.ts`. Keep the "keep DELIVERY last" pgEnum note
verbatim.

## Step 2 — schema + migration

Do this second: every remaining site becomes a compile error, which is how `tsc` enumerates the work.

- **`src/lib/db/projects-schema.ts`** — delete `projectDeliveryManagers` (L99-117); rewrite the
  module header (L28-43); retarget the `projectDeliveryNotes.authorStaffId` comment (~L231), which
  cites `projectDeliveryManagers.staffId` as its people-FK precedent, at `projectRoles.staffId`.
- **`src/lib/db/schema.ts:12`** — barrel comment → "projects, roles, delivery notes".
- `bun run db:generate` → expect `drizzle/0026_*.sql` with `DROP TABLE "project_delivery_managers"
  CASCADE;`. **Read the generated SQL before migrating** — this repo has no prior table-drop
  precedent (only `DROP COLUMN`s). No hand-edit needed; the `0025_empty_frank_castle.sql` hand-edit
  precedent applies only to multi-statement backfills.
- `bun run db:migrate`.
- **`scripts/seed/wipe.ts:29`** — drop `"project_delivery_managers"` from the truncate list.

## Step 3 — derived reads (delete four queries)

- **`getProjectPlan.ts`** — delete the junction query (L79-85) and import; `deliveryManagers:
  deliveryManagersOf(roles)` at L163. One fewer query per detail render.
- **`getOpportunityPlan.ts`** — same deletion (L182-188), same substitution (L272); update the
  `PlanProject.deliveryManagers` doc (L93-94) to say *derived from non-cancelled `DELIVERY` roles*.
- **`getProjectPto.ts`** — delete the whole DM leg (L69-86). "Role assignees ∪ delivery managers"
  collapses to the `selectDistinct staffId from project_roles` already there, because a DM *is* a
  role assignee now. Two queries → one; update the docstring.
- **`getMyAllocations.ts`** — delete `MyManagedProject`, the `min`/`max` group-by query over the
  junction, and `managedProjects` from `MyAllocationsView`. A DM seat is now a row in the first
  query with real dates and hours.
- **`src/lib/home/my-work.ts`** — delete the `managedProjects` parameter, `deliveryManagerOnly`,
  the null-`hoursPerDay`/null-dates branches and the DM-last tie-break in the `live` sort.
  `hoursPerDay`/`startDate`/`endDate` become non-nullable again — a real simplification (the
  header's third paragraph and the `startDate ?? ""` guards go).
- **`src/lib/home/my-work.test.ts`** — delete the `describe("… delivery-manager seats")` block
  (L215-254) and the `managed()` factory; fix the second argument at remaining call sites.
- **`src/components/home/my-allocations-table.tsx`** — delete the "Delivery lead" badge and
  em-dash hours branch (L106, L120-124); a DM row renders like any other allocation, with
  `Delivery` in the role-type sub-line.
- **`src/actions/staff/getStaffProjects.ts`** — delete the manager query and
  `DELIVERY_MANAGER_LABEL`; relationships come from `PROJECT_ROLE_TYPE_LABELS[roleType]` only.
  Keep the delivery-first sort by comparing against `PROJECT_ROLE_TYPE_LABELS.DELIVERY` (sourced,
  not a literal). The staff-profile label changes from "Delivery manager" to "Delivery".

## Step 4 — the list read (`src/actions/projects/getProjectsList.ts`)

One module-local condition, used by both SQL sites so they can't drift, with a `LOCKSTEP:` comment
naming `isDeliveryCoverage` as its pure mirror (the house convention — see `project-status-sql.ts`):

```ts
and(eq(projectRoles.roleType, "DELIVERY"), ne(projectRoles.status, ROLE_STATUS.cancelled))
```

- `getDeliveryManagerOptions()` (L255-263) → `selectDistinct` over `project_roles` +
  `innerJoin(staff)` (which drops open roles for free, since a null `staffId` can't join) + that
  condition, still `orderBy(asc(staff.name))`. Cancelled roles must not populate the options: an
  option that returns zero rows reads as a broken filter.
- The `deliveryManagerId` `EXISTS` (L220-235) → retarget at `project_roles` + that condition +
  `staffId`, same shape as the line-of-business `EXISTS` directly above it.
- **`assembleRows`: drop a query rather than adapt one.** Add `leftJoin(staff)` + `staffName` to
  the `roleRows` select (L357-371) and **delete the `managerRows` query** (L312-321) — three
  follow-ups become two. Derive `deliveryManagerNames` with `deliveryManagersOf` in the existing
  `for (const row of roleRows)` loop, so the Delivery column and the coverage flag are computed
  from one role set and cannot disagree. Update the docstring's fixed-query-count contract.
- `deliveryManagerNames` (L78) and `ProjectsListFilters.deliveryManagerId` (L126-135) keep their
  names; update both docs to "distinct named staff on non-cancelled `DELIVERY` roles".

**No change to `src/app/(app)/projects/page.tsx` beyond comments, and none at all to
`projects-list-filters.tsx` or the `dm` URL param** — `parseDeliveryManager` validates against
whatever `getDeliveryManagerOptions` returns. The filter keeps working untouched.

## Step 5 — delete the write paths

- **`createProject.ts`** (L44, L87-95) + **`createProject.schema.ts`** (L26) — drop
  `deliveryManagerIds` and the junction insert. The surviving `parsedInput.roles` path can already
  create a `DELIVERY` role.
- **`updateProject.ts` / `.schema.ts`** — collapses to a name-only update; the transaction and
  `generateId` go. Keep the action (its dialog also owns "Remove project", and the whole-record vs
  field-scoped split is documented as deliberate); update the docstring.
- **`updateProjectField.ts` / `.schema.ts`** — delete the `deliveryManagers` variant (L112-139 /
  L24-28) and the `generateId` import. Rewrite both headers: the "a name change doesn't rewrite the
  delivery-manager junction" rationale for the discriminated union is now stale and must be
  re-argued from the `company` case.
- **`src/lib/schemas/id-schema.ts:23-30`** — `idList`'s doc cites delivery managers as its example;
  swap for a surviving one (contacts, owners).
- **`add-project-dialog.tsx`** — drop `deliveryManagerIds` from `FIELD_FOR_ISSUE` (L51; the
  `Record<keyof CreateProjectInput, …>` type makes this a compile error by design) and fix the two
  strings saying "Add roles and delivery managers afterward…" → "Add roles — including a delivery
  role — afterward in its planner."
- **`use-project-inline-save.ts`** — docstring only.

**No permission changes.** Every gate stays as written; this only removes mutation surface.
`permissions.ts`'s RBAC role literally named `"delivery-manager"` is unrelated — do not touch it,
nor the "delivery-manager review" prose in `saveTimesheet.schema.ts` / `timesheet-week.tsx`.

## Step 6 — UI: sidebar and dialog

- **Delete `src/components/projects/detail/delivery-managers-field.tsx`.**
- **`project-detail-view.tsx:204-208`** — replace with a read-only `MetaField label="Delivery
  managers"` in the same position (after Line of business), carrying the same comment style:
  `{/* Derived from the project's DELIVERY roles, so it isn't an editable field. */}`. Lift the
  flex-wrap + trailing-comma `InternalLink` markup from the deleted field verbatim (it's tuned for
  the 320px rail). Each name gets a native `title` with its span
  (`"Jan 5, 2026 – Jun 30, 2026"`, joined with `" · "` when one person holds two roles) — the
  `docs/ui.md` rule for dates as tooltips, not inline text. **All-time, not current-only**: one
  definition across sidebar / column / filter, it mirrors the derived field above it, and a
  current-only field would render "—" on every finished engagement.
  Three explicit branches — never fall through to `MetaField`'s em dash, which on a field that just
  lost its pencil would read as lost data:
  1. named DMs → the links;
  2. no named DMs but ≥1 non-cancelled `DELIVERY` role → muted `Open Delivery role — nobody assigned`;
  3. no non-cancelled `DELIVERY` role → muted `Unassigned` (today's wording, so nothing regresses).
  Update the component docstring, which advertises delivery managers as inline-editable.
- **`opportunity-plan/edit-project-dialog.tsx`** — delete the `deliveryManagers` form value, the
  `Controller`/`EntityMultiCombobox` field, the `deliveryManagerIds` issue mapping and the
  `searchStaff` import; the dialog becomes name + Remove project. `EntityMultiCombobox` and
  `searchStaff` both stay alive (six CRM callers; `role-fields.tsx`, `planner-grid.tsx`).
- **`plan-summary-tiles.tsx`** (L46, L56, L104-110) + **`plan-summary.ts:52-57`** — delete the
  `deliveryManagers` prop, the `IconUsers` tile and `deliveryManagerLabel`. The project detail page
  already omits this tile; only the opportunity tab shows it, where the DM is now a visible row in
  the planner grid immediately below. `rangeOf`/`rangeLabel`/`yearHint` stay (and `rangeOf` is now
  also the gap detector's window helper).
- **`opportunity-project-plan.tsx:409`** — drop the `deliveryManagers` prop.

**No discovery copy in the sidebar.** A project with no delivery manager always has a
whole-project gap, so the notice below always fires on exactly that project and already says how
to fix it. One instruction, in the place that appears only when it applies.

## Step 7 — the warning

**New `src/components/projects/detail/delivery-coverage-notice.tsx`** — not `"use client"`
(mirroring `InlineNotice`'s own deliberate choice), props `{ gaps, timeline, canEdit }`.

`<InlineNotice icon={IconAlertTriangle} tone="muted">` — **muted, not destructive**. Per
`PROJECT_FLAG_VARIANTS`' rule only a loss earns colour, and `lowHealth` is `secondary` despite
being the strongest signal on a row. A coverage gap isn't money, and its commonest cause is a DM
role nobody extended when the engagement slipped. The precedent is
`budget-summary-panel.tsx:173-185` — a muted `IconAlertTriangle` notice about the plan's
*completeness*, which is exactly what this is.

Copy — ranges via `formatDateRange` (en dash, drift-safe), the same helper the list's Dates column
uses. The instruction sentence is `canEdit`-gated so a viewer without `projects.edit` gets the fact
and no busywork:

- Whole project uncovered (single gap equal to `timeline`) — collapses "no `DELIVERY` role at all"
  and "the role sits outside the project's dates" into one true sentence:
  > No delivery manager on this project. *(+canEdit)* Add a Delivery role to name who owns the engagement.
- One gap:
  > No delivery manager covers Sep 1, 2026 – Sep 14, 2026. *(+canEdit)* Add or extend a Delivery role to cover it.
- Several — lead sentence then a `<ul className="flex flex-col gap-1">`, mirroring
  `unsubmitted-weeks-banner.tsx:48`. **Enumerate 3, then a final `+N more` item**, full set in the
  `<ul>`'s `title` — the same truncation contract `RiskCell` and `LinesOfBusinessCell` use.

"Delivery" is capitalised because it is `PROJECT_ROLE_TYPE_LABELS.DELIVERY`, the literal string in
the role dialog's picker and the Roles table — that's the discoverability hook.

**`project-detail-view.tsx`** — render it between `BudgetSummaryPanel` and `<Tabs>` (after L239).
Above the tabs because a coverage gap is a fact about the plan as a whole, the same argument the
budget panel already carries at L229-230; the fix is reachable from both structural tabs, so
scoping it to one would be arbitrary. Compute with
`useMemo(() => deliveryCoverageGaps(roles), [roles])` beside the existing `weekColumns`/`rows` memos
— the module is pure and needs no clock, so no server change and no prop threading.

Rejected, with reasons worth keeping in the code comments: a `PlanSummaryTiles` entry (every tile
is a *figure*; "2 gaps" is meaningless without the dates, and the tiles are shared with the
opportunity surface); a band on `PlannerGrid` (shared with the allocations grid, its spine is
*weeks* so it would round a Tue–Thu hole to a whole column and lie). If the notice proves skippable
in use, the honest escalation is shading uncovered week-header cells plus a fourth legend swatch —
a separate change.

**Not on the opportunity Project-plan tab.** Because the notice lives in `project-detail-view.tsx`
rather than inside the shared components, the opportunity surface simply doesn't render one extra
sibling — no `surface` discriminator, no optional prop, no dead branch. If the pre-sale concern
(oversight not costed into a fixed fee) ever needs surfacing, its home is a *third*
`BudgetSummaryPanel` notice with a different trigger (`roles.every(r => r.roleType !== "DELIVERY")`,
no dates involved), shared by both surfaces for the same reason the other two are.

## Step 8 — seed (`scripts/seed/projects.ts`)

- Delete the `projectDeliveryManagers` import, `DeliveryManagerInsert`, the array, the 1–2-DM loop
  (L134-146) and the insert (L201).
- Add **1–2 `DELIVERY` roles per project**. Today every role on a seeded project shares one
  start/end, so a naive `DELIVERY` role would always cover perfectly and the warning would be
  invisible. Generate one of three shapes per project: **full coverage** (~55%), one role spanning
  the window; **handover seam** (~20%), two roles with the second starting the weekday after the
  first ends — this must produce **no** warning, and it's what proves the weekend logic on real
  data; **real gap** (~25%), a role covering the first ~60% of the window.
- `hoursPerDay` for `DELIVERY`: `faker.helpers.arrayElement([1, 2])`, not the 8 other roles draw,
  with a comment saying why (decision 4 — a full-time DM would read as over-allocated in the
  capacity meter and would move plan revenue).
- **Draw the non-DM `roleType` from `PROJECT_ROLE_TYPES` minus `DELIVERY`**, or the random draw
  plants accidental `DELIVERY` roles that silently close the gaps the third shape is creating.
- `billRate` via the existing `billRateFor({ lineOfBusiness, roleType: "DELIVERY" })` path — no
  special casing. Keep the "every role of a cancelled project is cancelled" rule.

## Step 9 — the projects-list flag

- **`src/lib/projects/project-flags.ts`** — add `noDeliveryManager` **third** in `PROJECT_FLAGS`
  (`negativeMargin`, `lowHealth`, `noDeliveryManager`, `lowMargin`, `endingSoon`): below
  `negativeMargin` (money already lost) and below `lowHealth` (a human report of actual trouble vs
  a risk of it), above `lowMargin`/`endingSoon` on the same logic the file already uses — an
  accountability hole is what *causes* health to go unrated and margin to drift unnoticed. Label
  "No delivery manager", variant **`secondary`** (only the loss gets colour; the file's own escape
  hatch for a coloured tier is a separate suppressing flag).
  `ProjectFlagInputs` gains one **required** field (required, not optional — the same
  compiler-pressure argument its `latestHealth` doc makes) holding the already-derived
  `DeliveryCoverageGap[]`, so this module imports no second derivation and stays free of date
  arithmetic. Predicate:
  ```ts
  noDeliveryManager: (input) =>
    isLive(input) && input.deliveryCoverageGaps.some((gap) => gap.endDate >= input.today),
  ```
  The `>= today` filter lives here so `today` is read exactly once per page (L420, "so two cards
  can't disagree about 'soon'") and this flag can't disagree with `endingSoon` about now. Wholly
  past gaps earning no badge is what stops the Past tab filling with permanent flags. The **detail
  page deliberately shows past gaps** — it's the editor, where a historical hole is either a data
  fix or a fact worth knowing. No new threshold constant, so `PROJECT_FLAGS_REVIEWED_ON` needs no
  bump.
- **`getProjectsList.ts`** — pass `deliveryCoverageGaps: deliveryCoverageGaps(rolesFor(id))` from
  the map built in step 4. Zero extra queries.
- **`project-flags.test.ts`** — add `deliveryCoverageGaps: []` to the `inputs()` factory and to the
  two hand-built cases (the order test ~L53 and the cancelled test ~L248, both of which the new
  required field makes compile errors); add a gap-ending-today fires / gap-ended-yesterday doesn't
  / cancelled-project doesn't case; extend the canonical worst-first order assertion.
- **`projects-table.tsx`** — no change. `DeliveryCell` keeps its truncation, `title` and
  `max-w-40`; only `deliveryManagerNames`' provenance changed. "Unassigned" widens from *nobody was
  ever named* to *no named person on a live Delivery role*, which now also covers "there is a
  Delivery role but it's open" — don't split it, the Roles column already publishes "N open" and
  the new flag is what says it matters.

## Verification

1. `bun run check` (Biome + `tsc --noEmit` + `bun test`) — must be green, including the new
   `delivery-coverage.test.ts` and the updated `project-flags.test.ts` / `my-work.test.ts`.
2. `bun run build` (compile + type-check; not a server).
3. `bun run db:generate`, **read `drizzle/0026_*.sql`**, then `bun run db:migrate`, then
   `bun run db:seed`. A stale seed is a `bun run check` failure, so the seed must land in this change.
4. **I don't run the app** (AGENTS.md). Please check and paste back:
   - `/projects/[id]` on a project seeded with the "real gap" shape — the notice appears above the
     tabs with the right dates, and the sidebar names the delivery managers as non-editable links.
   - `/projects/[id]` on a "handover seam" project — **no** notice (the weekend/contiguity case).
   - `/projects` — Delivery column populated, `?dm=<staffId>` filter still narrows the list, and
     the "No delivery manager" badge appears in Risk only on projects with a current-or-future gap.
   - An opportunity's Project-plan tab — no notice, no Delivery-managers tile, `DELIVERY` roles
     visible as ordinary planner rows.
5. Run `/code-review` and address findings before merging.

## Documentation

Dispatch the **`librarian`** subagent (AGENTS.md requires it automatically for a schema change)
with: the table drop, "a DM is a `DELIVERY` role", the derived read-only sidebar field, the
coverage module and its no-threshold/weekday rule, decision 4's billing and capacity consequence,
and the write-path deletions. It owns `docs/data-model.md` (L30, 32, 36, 66, 99, 144),
`docs/domains/projects.md` (~25 sites, densest at L132-137, 345, 474-551, 647-703, 970-1013,
1055-1114, 1422-1494), `docs/domains/allocations.md`, `docs/domains/staff-profiles.md`,
`docs/flows.md`, `docs/ui.md` (the `/projects/[id]` sidebar's "three inline-editable fields" → two;
the Risk column's flag set; `getDeliveryManagerOptions`), and the ADR lineage refs in
0017/0024/0033/0045/0053/0059/0066.

**New ADR `docs/decisions/0067-delivery-managers-as-project-roles-and-coverage-gaps.md`** (0066 is
the high-water mark): the junction → role collapse; the symmetric non-cancelled predicate and why
it follows neither the utilization report's confirmed-only nor the capacity meter's
confirmed+tentative; the weekday-gap definition with no threshold and open seats counting as gaps;
the derived read-only sidebar field; and decision 4's commercial consequence.
