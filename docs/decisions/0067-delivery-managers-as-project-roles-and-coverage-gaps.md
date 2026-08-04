# 0067 — A delivery manager is a project role, and delivery coverage is derived

**Status:** accepted · 2026-08-04 · **supersedes [ADR 0045](./0045-project-page-as-delivery-side-role-editor.md) §"delivery managers" in part**
(its field-scoped `deliveryManagers` variant no longer exists) and **corrects
[ADR 0066](./0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md) §3**, which
declared `project_delivery_managers` "unchanged and unrelated" and drew the distinction the
other way round. Everything else in both ADRs stands.

Drops one table (`drizzle/0026_normal_monster_badoon.sql`). **No permission, capability or
matrix change** — this only *removes* mutation surface.

> ⚠️ `src/lib/auth/permissions.ts` has an RBAC role literally named **`delivery-manager`**.
> It is unrelated to anything below and was not touched. Don't conflate the two.

## Context

`project_delivery_managers` was a pure junction ([ADR 0016](./0016-junction-table-and-shared-enum-conventions.md)'s
convention, followed exactly): a set of staff per project, with no dates, no hours and no
money. It could answer "who runs this engagement" and nothing else.

Three things it structurally could not do:

1. **Say who ran the project *in March*.** A person either was or wasn't a manager, forever.
   So a project could quietly lose delivery coverage mid-flight — the original manager rolls
   off, nobody notices, and the junction still reads as "covered".
2. **Cost or price the oversight.** Delivery time was invisible to plan revenue, margin, the
   capacity meter and every utilization figure, even though it is real billable work.
3. **Stay consistent with its neighbours.** A project's *status*, *lines of business*
   ([ADR 0033](./0033-line-of-business-on-role-derived-project-status.md)) and *health*
   ([ADR 0059](./0059-project-delivery-notes-and-list-health.md)) are all derived from its
   roles/notes. "Who runs it" was the one such fact still stored — and stored in the weakest
   possible shape.

Meanwhile [ADR 0066](./0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md) §3
had already added `DELIVERY` as a sixth `roleType`, "so delivery time can be planned and priced
like any other line". That made the junction redundant: the plan already had a place to say a
named person runs this project from these dates at these hours for this rate.

## Decision

### 1. The junction is dropped; a delivery manager is a `DELIVERY` role

`DROP TABLE "project_delivery_managers" CASCADE`. A project's delivery managers are now
**derived** from its `project_roles` rows with `roleType = "DELIVERY"`, exactly as its status
and LoBs are derived — one fewer stored fact, and the assignment gains dates, a status and a
price for free.

**Deliberately no backfill.** `project_roles` has five NOT NULL columns the junction couldn't
supply (`startDate`, `endDate`, `hoursPerDay`, `lineOfBusiness`, `billRate`), and two of them
would have been *lies with consequences*: an invented `billRate` fabricates revenue on every
existing project, and an invented `lineOfBusiness` changes each project's **derived LoB set**,
which drives filters and the projects list. The dev DB is synthetic seed data, so the honest
move was to re-seed. If this had to ship against production data, the backfill would need a
human decision per project, not a migration.

### 2. One pure module owns both "who runs this" and "when nobody does"

`src/lib/projects/delivery-coverage.ts` — pure and client-importable (no `db`, no React), the
same shape as `project-derived.ts` / `project-flags.ts` / `bill-rates.ts`. Every surface reads
it, so two of them can't disagree about whether an engagement is being run:

- `isDeliveryRole` — a live `DELIVERY` role, staffed or not.
- `isDeliveryCoverage` — the above **plus a named person** (§5).
- `needsDeliveryCoverage` — a live **non**-`DELIVERY` role: the work that needs managing.
- `deliveryCoverageGaps(roles)` → maximal chronological runs of uncovered **weekdays**.
- `deliveryManagersOf(roles)` → distinct `{ id, name, spans }`, name-ordered, **all-time**.

Each predicate is asserted **by name** in `delivery-coverage.test.ts` (23 cases), so flipping
one is a visible, deliberate change rather than a silent policy drift. `DELIVERY_COVERAGE_REVIEWED_ON`
mirrors `PROJECT_FLAGS_REVIEWED_ON`; there is deliberately no threshold *number* beside it (§6).

The manager list is **all-time, not "who runs it today"**: the `dm` filter is inherently
all-time (a `dm=` link should still find the engagement you ran last year), it mirrors the
derived "Line of business" field it sits beside, and a current-only list would render empty on
every finished project — reading as missing data rather than as "it's over". The dated reality
travels in `spans` (a tooltip) and in the Roles tab.

### 3. The window excludes delivery roles

`deliveryCoverageGaps` measures against `rangeOf(roles.filter(needsDeliveryCoverage))` — the
same `rangeOf` the Dates tile prints, so a gap is measured against exactly the span the UI
shows. Excluding delivery roles from the window matters twice, and both were real:

- A delivery manager wrapping up a month **past** the last engineer would otherwise *widen*
  the window it then trivially covers — a plan gets safer the longer its oversight over-runs.
- A project consisting of **only** delivery roles would be a self-covering tautology. With the
  filter it reports nothing, because there is nothing to manage.

### 4. Live = "not cancelled", symmetrically — matching neither existing precedent

Both `needsDeliveryCoverage` and `isDeliveryRole` accept `tentative`, `confirmed` and `paused`,
and reject only `cancelled`. **So a tentative delivery manager covers a confirmed engineering
span, and a paused one covers too.**

This deliberately follows neither sibling rule:

| Surface | Statuses counted | Question it answers |
|---|---|---|
| Utilization report ([0062](./0062-utilization-report-two-series-and-timesheet-disclosure.md)/[0064](./0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md)) | `confirmed` only | Whose capacity is *committed* |
| Planner capacity meter ([0060](./0060-allocations-capacity-meter.md)) | `confirmed` + `tentative` | Whose capacity is *consumed* |
| **This** | everything but `cancelled` | Does the **plan** account for delivery |

Confirmed-only was tried in thought and rejected: a plan born from an unwon opportunity is
*all* tentative, so it would light up as 100% uncovered at exactly the moment nothing is real
yet — the warning would be loudest where it is least actionable, and people would learn to
ignore it. `paused` work still carries the dates it expects to resume on, so the manager who
will resume it counts.

The predicate is also *deliberately not* `countsTowardBudget`, which it currently agrees with:
that answers "does this line's money belong in the budget". Sharing one function would move
coverage the day a commercial rule changed — the same reason `project-margin.ts` declines to
reuse the allocations grid's status filter.

### 5. An open (unstaffed) delivery role is a **gap**, not coverage

`isDeliveryCoverage` requires a named person. "No period without a delivery manager", read
literally: a seat nobody sits in contains no manager, and the alternative failure mode is
worse — the warning going quiet at exactly the moment nobody is accountable.

`isDeliveryRole` exists *only* so the sidebar can distinguish the two, saying
**"Open delivery role — nobody assigned"** instead of the flatly wrong "Unassigned" (which
would contradict the Roles tab showing the open line).

### 6. Weekends are never gap days; no minimum-gap threshold

The day scan `continue`s on weekends, so a Saturday is neither added to a run **nor allowed to
end one**. A delivery role ending Friday the 6th and its successor starting Monday the 9th
therefore yields *no* gap — the loop never visits an uncovered day between them. Without this,
near every clean handover would warn. A consequence worth knowing: **both gap bounds are always
weekdays**, so `formatDateRange` over a gap always names working days.

There is **no `MIN_DELIVERY_GAP_WEEKDAYS`**. A single uncovered weekday is reported. The cost
is real — a role typed one day short of its successor warns — but the benefit is a rule that
needs no number kept under review and no explaining. If it proves noisy the fix is one
`.filter(gap => gap.weekdays >= MIN_…)` on the way out, which is **why `weekdays` is carried on
every gap although nothing reads it yet.**

Cost is O(window days × delivery roles) — a few thousand string comparisons per project, and
`getProjectsList` already counts working days per role per project twice over for margin. A
merge-intervals sweep would be asymptotically better but would still have to count weekdays
inside each hole to tell a real gap from a weekend seam: the same iteration with more code.

### 7. ⚠️ Delivery time now counts as money and capacity — existing figures moved

This is the loudest consequence and the easiest to miss. A `DELIVERY` role carries
`hoursPerDay` and `billRate > 0` like every other line, so it now flows into:

- **plan revenue, cost and margin** (T&M revenue, and cost via its assignee's comp — so a
  delivery role is also a `projects.viewMargin`-gated cost row);
- the **fixed-fee hourly-value comparator** ([0066](./0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md) §7);
- the **allocations planner's capacity meter** ([0060](./0060-allocations-capacity-meter.md)) —
  a delivery manager now consumes capacity;
- the **utilization report's *Planned* series** ([0064](./0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md)),
  once the role is `confirmed`;
- the **home dashboard's staffing count** ([0063](./0063-home-dashboard-two-time-bases-and-point-in-time-staffing.md)) —
  running a project now staffs you;
- the home dashboard's own **load percentage**.

That is exactly what "treated the same as every other role" means, and it is the *point* rather
than a side effect: delivery oversight was previously free, which made every margin optimistic
and every manager look under-allocated. But it **silently moves numbers on existing projects**
as soon as delivery roles are entered, so a margin that changed for no visible commercial
reason has this as its first suspect.

The seed reflects the hazard: delivery roles get **1–2 h/day**, not 8. A full-time delivery
manager on three engagements would read as 300% allocated, and part-time oversight is the
honest default.

### 8. The sidebar field becomes read-only derived; the write paths are deleted

`delivery-managers-field.tsx` (inline-editable, junction-writing) is **deleted** and replaced by
`delivery-managers-meta.tsx` — a `MetaField` mirroring the derived "Line of business" field
directly above it: staff links, each name's spans in a `title` (`docs/ui.md`'s dates-as-tooltips
rule), and **three explicit branches, none falling through to `MetaField`'s em dash** (named
managers / "Open delivery role — nobody assigned" / "Unassigned"), because on a field that just
lost its pencil a bare dash reads as lost data.

So `/projects/[id]`'s sidebar now has **two** inline-editable fields (name, company), not three.
Naming a delivery manager means adding a `DELIVERY` role in the Roles tab — strictly more
capable, since the assignment is dated, statused and priced.

Deleted with it, all `projects.edit`-gated already and none replaced by anything looser:

- `createProject`'s `deliveryManagerIds` input and junction insert;
- `updateProject`, collapsed to a **name-only** update (no transaction, no `generateId`) — kept
  rather than deleted because its dialog also owns "Remove project";
- `updateProjectField`'s whole `deliveryManagers` variant, leaving that discriminated union at
  **two** variants (`name`, `company`). Two variants is still the right shape: `name` writes one
  column while `company` re-parents the project and carries both a data-integrity refusal and a
  two-company revalidation. Collapsing them would put that rule on a rename path.
- the delivery-manager multi-combobox in `edit-project-dialog.tsx`, and the
  **"Delivery managers" summary tile** in `PlanSummaryTiles` (plus `deliveryManagerLabel`). The
  tile only ever rendered on the opportunity tab — the detail page already suppressed it — and it
  restated a row now visible in the planner grid immediately below. What replaced it is a signal
  the tiles could never have carried: a warning that fires only when the plan has a hole.

### 9. Two surfaces for a gap, with deliberately different time horizons

**On `/projects/[id]`:** `DeliveryCoverageNotice`, an `InlineNotice` with `IconAlertTriangle`,
rendered **above the tabs** after `BudgetSummaryPanel` — a coverage gap is a fact about the plan
as a whole, and the fix is reachable from both the Timeline and the Roles tab, so scoping it to
one would be arbitrary. Three copy branches (whole project uncovered / one gap / several), which
lists 3 ranges then "and N more" with the full set in `title` (the list's truncation contract),
and the "Add or extend a Delivery role" instruction is `canEdit`-gated. Suppressed on a
`cancelled` project.

**`tone="muted"`, not destructive.** `PROJECT_FLAG_VARIANTS` reserves colour for a loss, and
`lowHealth` is neutral there despite being the strongest signal on a list row. A coverage gap
isn't money, and its commonest real cause is a delivery role nobody extended when the engagement
slipped. Precedent: `budget-summary-panel.tsx`'s incomplete-cost notice — a muted
`IconAlertTriangle` about the plan's *completeness*, which is exactly what this is.

**On `/projects`:** a third flag, `noDeliveryManager`, ordered
`negativeMargin` → `lowHealth` → **`noDeliveryManager`** → `lowMargin` → `endingSoon`, label
"No delivery manager", variant `secondary`. It sits below `lowHealth` (that's a report of actual
trouble; this is a *risk* of it) and above the money flags on `lowHealth`'s own logic: an
accountability hole is the condition that *causes* health to go unrated and margin to drift
unnoticed. `ProjectFlagInputs` takes a **pre-derived** `deliveryCoverageGaps`, so
`project-flags.ts` stays free of date arithmetic and owns no part of the coverage policy. Not
capability-gated — coverage is a delivery fact, not anything compensation-derived, the same
asymmetry `latestHealth` documents against `margin`. **No threshold constant was added, so
`PROJECT_FLAGS_REVIEWED_ON` was not bumped.**

**The two horizons differ on purpose.** The list flags only gaps ending **today or later**
(`isLive` *and* `gap.endDate >= today`), so the Past tab doesn't fill with permanent badges about
unfixable history. The **detail page deliberately shows past gaps**: it's the delivery-side
editor, where a historical hole is either a data error to fix or a fact worth knowing.

### 10. Not on the opportunity drawer's Project-plan tab

Deliberately absent. A pre-sale plan is all-tentative and often deliberately unstaffed, so the
notice would fire on nearly every opportunity — the [0031](./0031-opportunity-project-planner-and-role-status.md)
"soft plan" is exactly the state §4's rule is generous about, and a warning there would train
people to dismiss it before it ever meant anything.

Because the notice lives in `project-detail-view.tsx` rather than in the components the two
surfaces share, that tab simply renders one fewer sibling: **no `surface` prop and no dead
branch**, unlike the `deliveryManagers?`-style opt-out the deleted tile used.

**Deferred, don't build:** if uncosted pre-sale oversight ever needs surfacing, its home is a
*third* `BudgetSummaryPanel` notice about a plan with no delivery line at all — a completeness
observation next to the existing incomplete-cost one, not a coverage warning.

### 11. Read count went **down**, and the Delivery column can no longer disagree with the flag

Four junction reads disappeared and one folded away:

- `getProjectPlan` / `getOpportunityPlan` — the junction query is gone; `deliveryManagersOf(roles)`
  reuses role rows that already carried `staffId` **and** `staffName`. One fewer query each.
- `getProjectPto` — "role assignees ∪ delivery managers" collapses to the single
  `selectDistinct staffId` it already ran. Two queries → one.
- `getMyAllocations` — `MyManagedProject`, `managedProjects` and the `min`/`max` group-by query
  are **deleted**. A delivery manager is a row in the roles query.
- `getStaffProjects` — the manager query and its `DELIVERY_MANAGER_LABEL` are gone; relationships
  come from `PROJECT_ROLE_TYPE_LABELS` only, still delivery-first (compared against
  `PROJECT_ROLE_TYPE_LABELS.DELIVERY`, **sourced not typed**, so it can't drift from the string
  the Roles table shows). ⚠️ **The staff-profile relationship label changed from
  "Delivery manager" to "Delivery."**
- `getProjectsList.assembleRows` — the grouped manager-name query is **deleted** in favour of a
  `leftJoin(staff)` + `staffName` on the role query it already ran. Its documented contract goes
  from **three** follow-up queries to **two**, and the Delivery column and the coverage flag are
  now computed from **one** role set, so they cannot disagree.

`getProjectsList` also keeps a module-local `liveDeliveryRole` SQL condition, marked
`LOCKSTEP:` with `isDeliveryCoverage` as its pure mirror, backing both the `dm` `EXISTS` filter
and `getDeliveryManagerOptions()`. It omits the `staffId is not null` half because both call
sites either compare a specific staff id or inner-join `staff`, which drops open roles for free.

**The `dm` URL param, `parseDeliveryManager` and `projects-list-filters.tsx` are unchanged.** Two
meanings did shift underneath them, though: the filter's **option set is now derived from live
plan data and can shrink** (cancelling a role removes the person — deliberate, since the filter
excludes them too, and an option matching nothing reads as a broken filter), and
`DeliveryCell`'s **"Unassigned" widened** from *nobody was ever named* to *no named person on a
live delivery role* — which now also covers "there is a delivery role but it's open".

### 12. The home dashboard lost its special case

`my-work.ts` drops `managedProjects`, `deliveryManagerOnly` and every null-`hoursPerDay` /
null-date branch: `MyAllocationRow.hoursPerDay`/`startDate`/`endDate` are **non-nullable again**.
`my-allocations-table.tsx` loses the "Delivery lead" badge and the em-dash hours cell. A delivery
manager's row now renders like any other allocation, with `Delivery` in the role-type sub-line.

The old shape existed *only* because the junction had no dates and no hours — the row had to
borrow its window from whoever else was staffed, and show an em dash rather than invent a number
in a column people read down. That whole class of nullability was a symptom of the wrong schema.

## Consequences

- **Existing plan figures move** as delivery roles are entered — revenue, margin, capacity,
  planned utilization, staffing rate. See §7; it is the first thing to check when a number
  changes with no commercial cause.
- **A project can now be "covered" by a tentative manager.** Reading a covered plan as a
  *commitment* is wrong; it means the plan accounts for delivery. The Roles tab carries the
  status.
- **A one-day typo warns.** §6 has no threshold, so a delivery role ending one weekday before its
  successor starts produces a real gap with a real date range. The one-line filter is documented
  in the module for when that becomes annoying rather than informative.
- **`getDeliveryManagerOptions` can shrink.** A `dm=` bookmark can stop matching if the person's
  only delivery role is cancelled. Preferred over an option that matches nothing.
- **`deliveryManagersOf` is all-time, so it is not an answer to "who do I escalate to today".**
  The `spans` tooltip is the only thing that disambiguates in the sidebar.
- **The seed now encodes the policy in data.** Four coverage shapes per project — `full` (no
  warning), `seam` (a handover whose second role starts the *next weekday*, so **no** warning:
  the case that proves §6's weekend rule on real data rather than only in tests), `gap`
  (~60% covered, warns) and `open` (unstaffed, warns, and the only shape exercising the sidebar's
  "Open delivery role" state). Staffing lines draw from `STAFFING_ROLE_TYPES = PROJECT_ROLE_TYPES`
  **minus** `DELIVERY`, so a random draw can't plant a stray delivery role that silently closes a
  gap, and the delivery role **reuses one of the project's own staffing LoBs** rather than drawing
  afresh (a fresh draw would add a practice the project doesn't sell to its *derived* LoB set).
  Verified on the reseeded DB: 15 projects → 11 fully covered, 4 with gaps, 2 with an unstaffed
  delivery role, and every seam project reports zero gaps.
- **`idList` lost its most prominent consumer.** Its doc-comment example moved off delivery
  managers; the primitive stays, used by contacts/owners/source-staff.
- **One new test file** (`delivery-coverage.test.ts`, 23 cases) inside
  [ADR 0037](./0037-unit-tests-removed-except-rbac-matrix.md)'s "*small, deliberate* set of
  invariant tests" softening, plus new `noDeliveryManager` cases in `project-flags.test.ts`. The
  bar is met the way `org-chart`'s is: the predicates are **policy**, not arithmetic, and no type
  can state that a Friday→Monday handover is contiguous.
- **Nothing enforces that a project has a delivery role.** Coverage is surfaced, never required:
  a NOT NULL-style invariant would block creating a plan before staffing it, which is how plans
  are actually built.
