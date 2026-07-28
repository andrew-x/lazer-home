# Domain: Performance management

**Status: partially built.** Three concrete slices are realized: **peer feedback**,
a **compensation & headcount analytics dashboard**, and **staff rating levels
(L0–L4)**. The latter two are **two separate, separately-gated dashboards** —
`/performance/compensation` and `/performance/levels` — and **`/performance`
itself is not a page**: it's a permission-aware redirect to whichever dashboard
the viewer may see ([ADR 0044](../decisions/0044-performance-dashboards-split-by-permission.md);
they used to share one page, which [ADR 0032](../decisions/0032-staff-rating-levels-effective-dated-manager-only.md)
described — that framing is superseded). The broader review/goal machinery
(ReviewCycle, PerformanceReview, Goal) is still **proposed**.

## Purpose

Ground assessment and growth in real signals — peer input, project work,
utilization — rather than memory. The first shipped pieces let teammates capture
structured feedback about each other continuously (not just at review time), give
finance/managers an aggregate read on workforce compensation & headcount, and let
managers assign each person an overall performance **level** with a full history.

## Peer feedback — **built**

Any **active** staff member can leave structured feedback about any **other**
active staff member. It's a **point-in-time** record: immutable once left, not
effective-dated, and a person can leave feedback about the same person more than
once (no unique `(from, to)` constraint).

### Entity — `feedback` (`src/lib/db/performance-schema.ts`)

The performance domain's first table (barrelled by `src/lib/db/schema.ts`; the
migration history has been squashed into a single baseline more than once — the current
one is `drizzle/0000_lethal_rictor.sql` — so read the schema file for the definitive
shape rather than a per-feature migration):

- **`fromStaffId` / `toStaffId`** — giver and recipient, both FK → `staff.id`,
  both **`onDelete: cascade`** (feedback is meaningless without both people).
  Indexed on each side (`feedback_from_staff_idx`, `feedback_to_staff_idx`).
- **`rating`** — 5-point `feedback_rating` pgEnum. Values + labels + descriptions
  live in the pure, client-importable module **`src/lib/performance/feedback-rating.ts`**
  (`FEEDBACK_RATINGS`), the single source the pgEnum, the zod schema, and the
  form's radio group all import — same shared-enum pattern as
  `line-of-business.ts` ([ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md)).
  Scale (best→worst): `ABOVE_AND_BEYOND`, `TOP_PERFORMER`, `SOLID_CONTRIBUTOR`,
  `MINOR_MISSES`, `NEEDS_IMPROVEMENT`.
- **`context`** — required free text: how/when the giver worked with the person.
- **`keepDoing` / `stopDoing` / `startDoing`** — optional prompts, but the schema
  **requires at least one** (`createFeedback.schema.ts` refine).
- **`other`** — optional free text.
- **`messageToRecipient`** — optional, and the **only** content field a recipient
  ever sees (alongside the giver's name).

### Privacy — three tiers, enforced by the read projections

The privacy boundary is **the reads, not the table** — the hidden columns simply
never leave the server for unauthorized callers. Three tiers:

1. **Anyone (active staff) — give feedback.** Gated by the
   `authorizeFeedbackCreate` hook (`authorizeFeedback.ts`), **not** a capability:
   the caller must be active staff, the target a distinct active staff member.
   The giver always sees the full feedback they wrote (`getFeedbackIGave` +
   `getFeedbackDetail` giver branch).
2. **Recipient — limited view.** `getFeedbackAboutMe` projects **only** the giver's
   name, `messageToRecipient`, and date — never the rating, context, or
   keep/stop/start/other. `getFeedbackDetail` also refuses full content to a mere
   recipient.
3. **Reviewer (`feedback.review`) — full view.** Managers/admins can view **any
   individual** feedback item in full via `getFeedbackDetail` (full content for
   any id — the detail page `/feedback/[id]`). A dedicated **browse-all list** of
   everyone's feedback is **deferred / planned** — it existed briefly
   (`getAllFeedbackPage` + an `all-feedback-table`) but was removed for now; the
   `feedback.review` capability itself is unchanged and still the reviewer gate.

> **"Manager" here means the `feedback.review` role capability, not a reporting
> line.** There is **no per-person manager/report graph** anywhere in this
> codebase — visibility is purely role-based (manager/admin see everything).

### Deliberate gap — reviewers see their own feedback

`feedback.review` currently grants a reviewer full visibility of **any** feedback,
**including feedback about themselves** (`getFeedbackDetail` does not exclude the
reviewer as recipient). This is a **known,
accepted limitation for the first slice**, not an oversight — locking down
managers reading their own feedback (e.g. routing it through the limited recipient
view) is flagged **future work**. See [ADR 0023](../decisions/0023-feedback-privacy-tiers.md).

### Actions & UI

- Actions in `src/actions/feedback/`: `createFeedback` (+ `.schema`),
  `authorizeFeedback` (`canGiveFeedback` + `authorizeFeedbackCreate`),
  `getFeedbackAboutMe`, `getFeedbackIGave`, `getFeedbackDetail`,
  `searchStaffForFeedback` (auth-only recipient picker, active staff excluding
  self — no capability, since giving is open).
- UI: nav item `/feedback` (`IconMessageHeart`), pages
  `src/app/(app)/feedback/page.tsx` (a **two-tab** view — "About you" /
  "You've given"), `feedback/new/page.tsx` (the **dedicated give-feedback page**),
  and `[id]/page.tsx` (detail). Components under `src/components/feedback/`:
  `feedback-form` (the give-feedback form, rendered on the `/new` page — replaced
  the old dialog), `feedback-about-me`, `feedback-given-table`, and
  `feedback-detail-fields` (renders a single feedback item's full content, backing
  the `[id]` detail page). New vendored
  primitive `src/components/ui/radio-group.tsx` (Base UI `Radio`/`RadioGroup`)
  for the rating picker. The recipient tab warns that only the message-to-recipient
  is visible; the detail page gates full content via `getFeedbackDetail`.

## The two analytics dashboards + the `/performance` redirect

The analytics live on **two sibling routes with different gates** — this is the
security boundary, encoded in the route structure ([ADR 0044](../decisions/0044-performance-dashboards-split-by-permission.md)):

| Route | Title on page | Gate | Read | Component |
|---|---|---|---|---|
| `/performance/compensation` | "Compensation dashboard" | `staff.viewCompensation` (finance/manager/admin) | `getCompensationSummaryData` + `getExchangeRates`, **plus `getRatingsSummaryData` iff `ratings.view`** | `CompensationDashboard` (`compensation-dashboard.tsx`) |
| `/performance/levels` | "Performance dashboard" | `ratings.view` (**manager/admin only**, not finance) | `getRatingsSummaryData` **only** (no FX — no money on this page) | `PerformanceDashboard` (`performance-dashboard.tsx`) |
| `/performance/levels/edit` | "Edit levels" | `ratings.edit` | `getStaffRatingsForEdit` | `EditLevels` (`edit-levels.tsx`) |

**All money lives on the Compensation dashboard** — including the one cross-domain
cut, **compensation by level** (see below). `/performance/levels` shows no
compensation at all.

**`/performance` is a redirect, not a page** (`src/app/(app)/performance/page.tsx`):
`staff.viewCompensation` → `/performance/compensation`, else `ratings.view` →
`/performance/levels`, else `notFound()`. The order matters — finance holds only
the comp capability and must never land on levels. The sidebar's **parent** nav
entry still points at `/performance`, which is why the redirect exists.

**Each dashboard owns its own filter + currency state**; they share only the
module `dashboard-filters.tsx`:

- `useDashboardFilters()` — line-of-business / employment-type / role (`ALL`
  sentinel default) + CAD/USD display currency.
- `DashboardFilterBar` — the three segmented filters + (conditionally) the currency
  toggle and its FX-freshness note. **`rates?: ExchangeRates` is optional and the
  toggle renders iff it's passed**, so a dashboard can't offer a currency choice
  without the rates that would honour it. The levels dashboard passes no `rates` →
  no toggle. (`useDashboardFilters` still holds `currency` for both; levels just
  never reads it.)
- `matchesFilters(dimensions, filters)` — the in-memory predicate. **Nuance:**
  `null` dimensions (the rare active staffer with no employment row) pass **only**
  while every filter is "All" — any narrowing excludes them, since there's nothing
  to match.
- `FilterOptions` — the enum option lists type (moved here from the old combined
  dashboard); the values come from `performanceFilterOptions`, exported by
  `getCompensationSummaryData` so pages never import Drizzle.

Aggregate money formatting is factored out into
**`aggregateMoneyFormatters(currency)`** (`src/lib/format/currency.ts`) → `{ money,
range }` — whole dollars, em dash for the `null` an empty group yields. It was
duplicated inline in the merged page's two halves; **now only the Compensation
dashboard uses it**, since it owns every money-bearing table.

**Nav** (`src/components/app-shell/nav.ts`): the Performance parent keeps
`permission: { staff: ["viewCompensation"] }` — deliberately the section's
**loosest** gate, valid only because every role granting `ratings.view` also grants
`staff.viewCompensation`. **If that matrix relationship changes, change this parent
gate too**, or the parent would hide Levels from someone entitled to it. Children:
Compensation (no extra gate), Levels (`ratings.view`), Edit levels (`ratings.edit`).
Consequence: finance sees only **one** visible child, so `NavMenuItem` degrades to
a plain link to `/performance` (which redirects) — see [ui.md](../ui.md) →
*App shell & sidebar* → Submenus.

## Compensation dashboard — **built**

The first **analytics** slice: **`/performance/compensation`** shows workforce
**compensation & headcount**, overall and broken down **by role** and **by staff
level**. Metrics per group: headcount, average compensation, comp range (min/max),
average hourly rate, and hourly-rate range. Reads **no new table** — it aggregates
the latest `staff_employment` row per **active** staff member (the same
latest-row-per-staff pattern `getStaffDirectory` uses). **No charting library** —
KPI cards, plain tables, and a **hand-rolled inline-SVG scatter** (see below).
Layout order: KPI cards → by-role table → **by-level table** → scatter.

- **"Compensation" = `base + guaranteedBonus`** (excludes `discretionaryBonus`,
  which isn't imported yet). Hourly stats use the stored `hourlyRate` column.
- **Filters** (segmented controls, default "All"): line of business, employment
  type (`FULL_TIME` / `HOURLY`), and role — from the shared `dashboard-filters.tsx`
  (above). Applied client-side over the once-fetched rows.
- **Currency toggle (CAD / USD).** Comp is stored per person in their own
  currency; all amounts are normalized to the selected display currency via live
  FX rates. See [ADR 0029](../decisions/0029-external-fx-rates-and-currency-normalization.md)
  for the FX pattern (first live external API call — frankfurter.dev, USD
  cross-rate, never-throw fallback). When rates are stale the page shows a "rates
  unavailable" note.

### Compensation by level — the one cross-domain cut, needs BOTH capabilities

The by-level table (Level | Headcount | Avg comp | Comp range | Avg hourly | Hourly
range, same columns as the by-role table above it) is *money grouped by level*, so
it lives here rather than on the levels dashboard
([ADR 0044](../decisions/0044-performance-dashboards-split-by-permission.md)) and it
requires **both** capabilities:

- the **page gate** is `staff.viewCompensation` — no bulk comp without it;
- the **levels input is fetched conditionally**:
  `const canViewLevels = userHasPermission(user, { ratings: ["view"] })`, then
  `canViewLevels ? getRatingsSummaryData() : undefined`, passed as the optional
  **`ratingRecords`** prop. Undefined → the table isn't rendered.

So **finance sees this dashboard minus the by-level table**; managers/admins see all
of it. Enforcing the stricter capability by *not reading the data* is the strongest
form available on a server page — and the mirror-image tightening is that
`/performance/levels` surfaces no compensation at all.

**Reading nuance:** only **rated** staff **with** an employment row contribute, so
this table's "All levels" footer can total less than the headcount KPI above it. Its
own empty state is "No rated staff match the selected filters". It's computed by
**reusing `computeByRole`** (`performance-stats.ts`) with the level label as the
group key, over `LEVEL_ORDER` (ascending L0 → L4).

> **Caveat — `getRatingsSummaryData` carries comp amounts, and is gated on
> `ratings.view` alone.** `RatingRecord.employment` is the full
> `CompensationDimensions` (`base`, `guaranteedBonus`, `hourlyRate`, `currency` — not
> just role / LoB / employment type), because the by-level table needs them. So
> `/performance/levels` still **ships** those amounts in its RSC payload even though
> it now **renders** no money. Safe today only because every role holding
> `ratings.view` also holds `staff.viewCompensation` — the same matrix coupling the
> nav parent relies on. **If `ratings.view` is ever granted to a role without
> `staff.viewCompensation`, this read becomes a bulk-comp leak**; at that point
> `getRatingsSummaryData` must either require both capabilities or project the
> amounts away (and the by-level table would move to a read of its own).

### Access control — reuses `staff.viewCompensation` (no matrix change)

An aggregate comp view is **bulk comp exposure**, so it's gated by the **existing**
`staff.viewCompensation` capability (finance / manager / admin — the same gate on
individual comp; see [permissions.md](./permissions.md)). **The permission matrix
is unchanged.** Defense in depth: the page `notFound()`s unauthorized users
(matching the hidden nav item), and the read `getCompensationSummaryData` calls
`requirePermission(user, { staff: ["viewCompensation"] })` again server-side
(`getRatingsSummaryData` likewise re-checks `ratings.view`).

The nav entries are **hidden** from users who lack the capability via the
permission-aware sidebar mechanism (`NavItem.permission` → `visibleNavHrefs`; see
[ui.md](../ui.md) → *App shell & sidebar* and [architecture.md](../architecture.md)).
A user with **neither** capability can't even reach the section: `/performance`
`notFound()`s them rather than redirecting.

### Data read — anonymized rows

`getCompensationSummaryData` (`src/actions/staff/`) returns **anonymized** rows —
dimensions (lineOfBusiness/role/employmentType/currency) + amounts, **no
id/name/email**. Identity never leaves the server even for authorized viewers: the
client only filters, currency-normalizes, and aggregates. It also exports
`performanceFilterOptions` (the enum arrays) so the page/UI never import Drizzle.

### Pure helpers & UI

- **`src/lib/format/fx.ts`** (`AED_PER_USD`, `FALLBACK_USD_RATES`, `convert`) and
  **`src/lib/performance/performance-stats.ts`** (`computeGroupStats`, `computeByRole` — pure
  aggregation over normalized rows; empty groups yield `null` so the UI renders an
  em dash, not NaN). Both client-importable.
- UI: `src/app/(app)/performance/compensation/page.tsx` (server — the double read,
  ratings conditional), `compensation-dashboard.tsx` (client — KPI cards for
  headcount / avg comp / avg hourly, the by-role table, the by-level table (when
  `ratingRecords` is passed), the distribution scatter + its metric toggle; renders
  `DashboardFilterBar` **with `rates`**, so this is the dashboard with the currency
  toggle, using its own `useDashboardFilters()` instance), the reusable
  `stat-card.tsx` (a KPI tile extracted from the Home page's inline pattern), and
  `compensation-scatter.tsx` (the scatter, below).

### Distribution scatter

A **single-series scatter** at the bottom of the dashboard — one dot per staff
member, sorted **ascending** by the plotted value, so the eye reads the spread's
shape. X is just the employee rank (1..n, ticks hidden); y is the numeric value;
per-dot detail is a native `<title>`. A **metric toggle** (segmented control)
switches between **Compensation** (`base + guaranteedBonus`) and **Hourly rate**
(`hourlyRate`), both normalized to the selected display currency like the rest of
the dashboard. It **reuses the dashboard's already-filtered, currency-normalized
per-staff rows** — the memo now returns the individual `StatRow[]` (`rows`)
alongside the aggregates, so no extra read or recompute. `CompensationScatter`
(`src/components/performance/compensation-scatter.tsx`) is metric-agnostic: it
takes plain `values: number[]` + a `formatValue` + a `caption`. **The chart is
hand-rolled inline SVG — no charting library.** This is the documented pattern for
charts in this codebase; see [ui.md](../ui.md) → *Charts (hand-rolled SVG)* for the
dataviz styling rules.

## Staff rating levels (L0–L4) + per-role subratings — **built**

Each person gets an **overall performance level** — a single integer **L0–L4** a
manager assigns and adjusts over time — distinct from peer feedback (per-interaction)
and compensation, **plus optional per-category subratings** (each **L1–L4**) whose
rubric differs per role. Surfaced on their own route — the **Performance dashboard**
at `/performance/levels` (analytics) and the editor at `/performance/levels/edit`.
**Effective-dated exactly like `staff_employment`
([ADR 0007](../decisions/0007-staff-employment-effective-dating.md)):** saving an
evaluation inserts a **new dated row per changed staff member** carrying **both**
the level and the subratings (co-dated, so subrating history is preserved exactly
like the level), and the current state is the latest row per staff. Full rationale in
[ADR 0032](../decisions/0032-staff-rating-levels-effective-dated-manager-only.md)
(level) and [ADR 0042](../decisions/0042-per-role-subratings-app-owned-jsonb.md)
(subratings).

### Entity — `staff_rating` (`src/lib/db/performance-schema.ts`)

- **`staffId`** — FK → `staff.id`, `onDelete: cascade`. Indexed (`staff_rating_staff_idx`).
- **`effectiveDate`** — `date` (string mode); as-of date of this evaluation.
- **`level`** — `integer`, **nullable**. `null` = explicitly **unrated** *as a
  historied event* (a manager can set someone back to no rating); a staffer with
  **no rows** is likewise unrated — both collapse to "Unrated" in every read. A DB
  `CHECK` (`staff_rating_level_range`) enforces `level is null or 0..4`.
- **`subratings`** — `jsonb().$type<Subratings>()`, **nullable** (`drizzle/0007_high_mister_sinister.sql`).
  Per-category scores as `Record<categoryKey, level>` (each level **1–4**),
  keyed by the **role's rubric**; `null`/absent = no subratings recorded. **The
  overall `level` is independent** — subratings are extra detail, NOT a derivation
  of it. The DB stores the raw jsonb; **the valid keys/shape are owned by the
  rubric module and validated at the zod/action layer, not the DB** (mirrors the
  survey `responses` jsonb — so adding/tuning a rubric needs no migration). See
  [ADR 0042](../decisions/0042-per-role-subratings-app-owned-jsonb.md).
- **`evaluatedByUserId`** — FK → `user.id`, `onDelete: set null` (audit; a rating
  outlives the evaluator's record).

The rubric lives in a second pure, client-importable module
**`src/lib/performance/rating-rubric.ts`** (no drizzle) — the single source of
truth for subratings shared by the schema's typed column, the edit grid, and the
save action's key validation. It exports `SUBRATING_MIN`/`MAX` (1–4),
`SUBRATING_LEVELS`, `type Subratings = Record<string, number>`,
`type RubricCategory`, `ROLE_RUBRICS` (`Partial<Record<Role, RubricCategory[]>>` —
**only `ENGINEER` populated so far**, 8 categories: communications, project
management, relationship management, outcomes ownership, technical depth, technical
breadth, output craft, AI tooling competency), `rubricForRole(role)` (→ `[]` for a
role with no rubric or `null`), and the flattened union helpers
`ALL_RUBRIC_CATEGORIES` / `ALL_RUBRIC_KEYS` / `RUBRIC_LABELS` the edit grid
consumes. It reuses the `L`-prefix display + string codec from
`staff-rating.ts` (the scale is L1–L4, no L0). **Category keys are stable
identifiers stored in the jsonb — renaming a key needs a data migration; labels
change freely.**

The overall-level module is **`src/lib/staff/staff-rating.ts`** (`RATING_LEVELS`,
`MIN/MAX_RATING_LEVEL`, `formatLevel` → `"L0".."L4"`/`"Unrated"`, `formatAverageLevel`
→ `"L2.3"`, and the Select-value helpers `encodeLevelValue` /
`decodeLevelValue` / `UNRATED_SELECT_VALUE` = `"none"` that map a level ↔ the edit
dropdown's plain-string draft) — the single source the schema's `CHECK`, the zod
schema, and the UI share, same shared-enum pattern as `feedback-rating.ts`
([ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md)). The
current-row ordering fragment is **`latestRatingFirst`**
(`src/lib/staff/staff-rating-history.ts`, `desc(effectiveDate)` then `desc(createdAt)`),
a mirror of `latestEmploymentFirst` — kept out of the pure module so drizzle never
leaks into a client bundle.

### Access control — manager/admin-only, NO self-view (stricter than comp/feedback)

A new resource **`ratings: ["view", "edit"]`**, granted to **manager + admin only**
— deliberately **not finance** (unlike `staff.viewCompensation`). **There is no
owner-visible path: a staffer never sees their own level, nor anyone else's** —
stricter than compensation (own comp always visible) and feedback (recipients see a
limited projection). A bare L-number has no constructive owner framing, so it stays
entirely inside the manager/admin tier. See [permissions.md](./permissions.md) and
[ADR 0032](../decisions/0032-staff-rating-levels-effective-dated-manager-only.md).

Defense in depth: both reads `requirePermission({ ratings: ["view"] })`, the write
gates `metadata.permission: { ratings: ["edit"] }`, and **`/performance/levels`
`notFound()`s anyone without `ratings.view`** — finance is redirected to
`/performance/compensation` and has no levels route to land on.

**`/performance/levels` shows no compensation at all.** The one money-shaped cut
(comp by level) lives on the Compensation dashboard, where the page gate is the comp
capability and the levels data is fetched only for `ratings.view` holders — so that
table needs **both** capabilities and the `ratings.view` gate alone can never reach
bulk comp ([ADR 0044](../decisions/0044-performance-dashboards-split-by-permission.md)).
Note that `ratings.view` *does* still let a holder see level data joined to nothing
financial — distribution, averages, subratings.

### Server layer (`src/actions/performance/`)

- **`getRatingsSummaryData`** (server-only read, `ratings.view`) — **anonymized**
  per-active-staff rows (`RatingRecord` = `CompensationRecord` + `level` +
  `subratings: Subratings | null`; no id/name/email — subratings carry no identity,
  only aggregated), for the levels dashboard. Latest employment row + latest rating
  row per active staff (two queries each, `firstPerKey`, no N+1). It exports **no**
  filter-option list — `/performance/levels` imports `performanceFilterOptions` from
  `getCompensationSummaryData` (both dashboards filter on the same enums).
- **`getStaffRatingsForEdit`** (server-only read, `ratings.view`) — one row per
  active staff (name, current role **and line of business** for context/filtering)
  for the edit table. The current level is returned **encoded as a string**
  (`level: "none" | "0".."4"` via `encodeLevelValue`) so the editor's dropdown draft
  is a plain string, like the other bulk-edit dropdowns. `StaffRatingEditRow` also
  carries **`subratings: Subratings`** — the current per-category scores as **raw
  1–4** (`{}` when none, from the latest rating row); the client encodes each
  per-cell for the role-specific columns.
- **`saveStaffEvaluation`** (+ `.schema`, `secureActionClient`, `ratings.edit`) —
  inserts one new dated `staff_rating` row per **genuinely-changed** staff, each
  carrying **level + subratings** (a single multi-row insert, atomic — no explicit
  transaction). Never trusts the payload: re-reads each target's current level,
  current subratings, **and current role** (latest employment); **drops no-ops**
  (skips only when BOTH the level is unchanged AND the subratings are value-equal —
  `canonicalSubratings` = sorted-key JSON, order-independent); **sanitizes subrating
  keys against the person's current-role rubric** (`sanitizeSubratings` drops
  unknown/stale keys, collapsing to `null` when nothing survives — so a crafted
  payload can't smuggle keys); rejects unknown/inactive targets; and **rejects an
  effectiveDate that predates a staff member's latest rating** (equal dates are fine
  — the `createdAt` tiebreak makes the newer write current); effectiveDate defaults
  to today. The zod schema validates subratings **loosely** (`record(string, int
  1–4)`, since valid keys are role-dependent) and the action hardens them. Template
  was `commitBulkEditEmployment`.

### Pure stats & UI

- **`src/lib/performance/rating-stats.ts`** (+ test) — pure `computeLevelDistribution`,
  `countUnrated`, `computeAverageLevel`, `computeAverageLevelByRole`, and
  `computeAverageSubratingsByRole` (per-role average subrating per rubric category —
  types `SubratingStatRow` / `SubratingCategoryAverage` / `RoleSubratingAverages`;
  only roles with a rubric **and** at least one scored category are emitted, each
  category's average taken over the people who scored it). This module is all the
  levels dashboard needs — the money-shaped comp-per-level table (which reuses
  `computeByRole` from `performance-stats.ts`) lives on the **Compensation**
  dashboard.
- **The Performance dashboard** (`/performance/levels`) — `performance-dashboard.tsx`
  exports **`PerformanceDashboard`**, which *is* the levels dashboard: it absorbed
  the former `levels-section.tsx` (**deleted**) when the page split
  ([ADR 0044](../decisions/0044-performance-dashboards-split-by-permission.md)), so
  it now owns its own `useDashboardFilters()` + `DashboardFilterBar` instead of
  taking filter values as props. It renders exactly four things: stat cards (average
  level / unrated), a hand-rolled SVG **bar chart**
  (`level-distribution-bar-chart.tsx`, **zero baseline**; see [ui.md](../ui.md) →
  *Charts*), an average-level-by-role table, and a **"Subratings by category"
  breakdown** — one small table per role (Category | Avg subrating | Rated),
  rendered only when there are scored subratings, from
  `computeAverageSubratingsByRole`. Everything is **anonymized and
  filter-respecting** (subratings carry no identity — only aggregated). **No money,
  no FX, no currency toggle**: it takes no `rates` prop and passes none to
  `DashboardFilterBar`, and it imports none of `convert` / `aggregateMoneyFormatters`
  / `computeByRole`. The page `<h2>` is "Performance dashboard", so the old inner
  `<h3>Levels</h3>` header is gone and the inner headings shifted up one level
  (`h3`/`h4`).
- **The editor** `/performance/levels/edit/page.tsx` → `edit-levels.tsx` reuses the
  shared `EditableTable`/`useEditableRows` batch pattern (a level dropdown per active
  staff, save-on-dirty bar, confirm-diff dialog) and offers **name search + role +
  line-of-business filters**; its "back" link points to `/performance/levels`
  ("Back to performance dashboard"). It's reached from the **Performance sidebar
  submenu** ("Edit levels", gated on `ratings.edit`), not from a button on the
  dashboard (see [ui.md](../ui.md) → *App shell & sidebar* → Submenus).
  **Subrating matrix:** selecting a **single role** in the Role filter (one that has
  a rubric) expands the grid with that role's categories as **editable** columns (a
  "No rating" + L1–L4 Select per category). With the **"All" filter** (or a role with
  no rubric) the per-category cells aren't editable — instead a **read-only
  "Subratings" column** shows each staffer's current scores as compact chips (short
  category label + level, e.g. "Comms L3"), only for roles with a rubric. To keep
  rows comparable it renders **every** category in the rubric in the **same fixed
  order** (chips line up in identical columns across rows), with unscored categories
  showing a muted "–" in a fixed-width value slot rather than being omitted; the
  whole column is hidden for a staffer only when none of their categories are
  scored. Each row keeps an **"Edit ›" shortcut** that
  filters to the staffer's role to reveal the editable matrix. The chips use the
  optional **`short`** label on `RubricCategory` (`rating-rubric.ts`), which falls
  back to `label` (the ENGINEER rubric supplies short labels).
  **Implementation nuance — the draft flattens each subrating category into its own
  string field** alongside `level` (`type EditableValues = { level: string } &
  Record<string, string>`, tracked fields = union of `ALL_RUBRIC_KEYS` across roles)
  rather than nesting a `Subratings` object, so the shared `EditableTable`/
  `useEditableRows` engine diffs each category with `!==` (a nested object would
  compare by reference) and the confirm dialog lists changed categories for free.
  **The shared engine (`src/components/admin/editable-table.tsx`) was NOT modified.**

### Own route, still no tabs

The levels analytics are a **separate `ratings.view`-gated route**, not a section of
the compensation page and **not a tab** — see *The two analytics dashboards* above
and [ADR 0044](../decisions/0044-performance-dashboards-split-by-permission.md) for
why (differently-gated audiences shouldn't share a page whose shape silently
changes by role; tabs across two gates would either 404 or vary per viewer).
Historical note for anyone reading older docs or commits: levels lived **inline on
`/performance`** behind an optional `ratingRecords` prop for a while (ADR 0032),
and before that behind a cross-route `performance-tabs.tsx` bar. Both are gone;
`levels-section.tsx` and `performance-tabs.tsx` no longer exist.

### Seed

`scripts/seed/performance.ts` gained **`seedRatings`** (weighted levels, ~20%
unrated, ~40% of rated also get an earlier historical row so the effective-dating
is exercised); wired into `scripts/seed.ts`, and `staff_rating` added to
`scripts/seed/wipe.ts`. It now reads each person's **current role** from
`staff_employment` and gives engineers **random L1–L4 subratings across their
role's rubric on the current rating row only** — historical rows are left without
subratings, modeling that subratings were introduced later than the level.

## Still proposed

- **ReviewCycle** — a period in which reviews happen (quarterly, annual).
- **PerformanceReview** — a Person's assessment within a cycle; may pull in project
  work and utilization.
- **Goal** — an objective for a Person, tracked over time.

Proposed flows: review cycle (open → collect self/manager/peer input → assess →
close), goal setting & tracking, and an evidence pull surfacing allocations,
utilization, and project contributions as review context.

## Connects to

- **Staff profiles** — feedback is staff↔staff; both endpoints are `staff` rows.
  Only **active** staff participate. Both analytics reads join the latest
  `staff_employment` row per **active** staff member — the Compensation dashboard to
  display money, the levels read for filter dimensions (**though `RatingRecord.employment`
  still carries the amounts** — see the caveat under *Compensation by level*).
  Ratings are keyed to `staff` (cascade) and shown only for **active** staff. Future
  reviews would target a Person and may update role/seniority.
- **Timesheets / Allocations** — utilization and delivery are intended review
  inputs (not yet wired).
- **Permissions** — `feedback.review` (manager + admin) is the reviewer tier; the
  Compensation dashboard reuses `staff.viewCompensation` (finance/manager/admin);
  the Performance (levels) dashboard + editor use `ratings.view` / `ratings.edit`
  (manager/admin **only** — not finance, no self-view), and its comp-by-level table
  additionally requires `staff.viewCompensation`. See
  [domains/permissions.md](./permissions.md).

## Open questions (for the proposed pieces)

- Review types: self / manager / 360, and how peer feedback feeds them.
- How tightly utilization factors into ratings (and who can see it).
- Cycle cadence; whether the peer-feedback rating scale is reused for reviews.
- Locking down reviewers seeing their own feedback (the deferred gap above).
</content>
</invoke>
