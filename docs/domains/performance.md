# Domain: Performance management

**Status: partially built.** Four concrete slices are realized: **peer feedback**,
a **compensation & headcount analytics dashboard**, **staff rating levels
(L0–L4)**, and **compensation change plans**. The middle two are **two separate,
separately-gated dashboards** — `/performance/compensation` and
`/performance/levels` — and **`/performance` itself is not a page**: it's a
permission-aware redirect to whichever dashboard the viewer may see
([ADR 0044](../decisions/0044-performance-dashboards-split-by-permission.md);
they used to share one page, which [ADR 0032](../decisions/0032-staff-rating-levels-effective-dated-manager-only.md)
described — that framing is superseded). Plans live at
`/performance/compensation-plans` — the one identity-bearing surface here
([ADR 0046](../decisions/0046-compensation-change-plans-rating-writing-proposals.md)).
The broader review/goal machinery
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

It also owns the two **write-hardening helpers** every path that persists subratings
must run them through — **`sanitizeSubratings(subratings, role)`** (drop keys not in
that role's rubric, collapsing to `null` when nothing survives — load-bearing
validation, since the zod layer can only check *values*, not role-dependent *keys*)
and **`canonicalSubratings`** (sorted-key JSON, so no-op detection compares by value).
They were extracted here out of `saveStaffEvaluation.ts` once compensation-plan commit
became a **second writer of `staff_rating`**; change them here, never in one action.

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
  payload can't smuggle keys — **both helpers now live in the pure
  `rating-rubric.ts`**, shared with `commitCompensationPlan`); rejects
  unknown/inactive targets; and **rejects an
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

## Compensation change plans — **built**

A **plan** is a named, effective-dated **proposal** covering a cohort of staff: for
each person a proposed rating (level + subratings), a proposed compensation figure,
three workflow checkboxes, and two note fields. **Committing a plan writes the
ratings as each person's latest `staff_rating` — and deliberately does NOT write
compensation.** Rippling remains the sole writer of `staff_employment`
([ADR 0020](../decisions/0020-compensation-effective-dated-import-only.md) **stands,
un-superseded**); the planned figure stays a proposal, and commit instead freezes a
snapshot of what comp *was* so a committed plan can show a stable before/after and
flag drift. Full rationale — including the separable seam for a possible future comp
write, and why it would still need a new ADR — in
[ADR 0046](../decisions/0046-compensation-change-plans-rating-writing-proposals.md).

### Entities — `compensation_plan` + `compensation_plan_item`

Both in `src/lib/db/performance-schema.ts` (`drizzle/0009_jittery_wolfsbane.sql`).
Neither is effective-dated: a plan is a **document**, not a fact about a person, so
[ADR 0007](../decisions/0007-staff-employment-effective-dating.md)'s pattern doesn't
apply — the *history* it produces lives on `staff_rating`.

**`compensation_plan`** — `name`; `status` (new `compensation_plan_status` pgEnum,
`DRAFT` | `COMMITTED`, values from the pure module below per
[ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md));
`effectiveDate` (`date`, string mode — the date committed ratings are dated with,
editable while draft); `createdByUserId` / `committedByUserId` (FK → `user`,
`set null`, audit); **`committedAt`** — null while draft, and the **idempotency
guard** that makes a second commit an error rather than a duplicate write.

**`compensation_plan_item`** — one row per staff member per plan:

- **`planId`** (FK → plan, cascade) / **`staffId`** (FK → `staff`, cascade — an item
  is meaningless without the person, mirroring `staff_rating`). Index on `planId`; a
  **unique index on `(planId, staffId)`** makes a membership reconcile idempotent.
- **`level`** (`integer`, nullable, same `0..4` `CHECK` as `staff_rating`) +
  **`subratings`** (jsonb `Subratings`) — the proposed rating, mirroring
  `staff_rating`'s shape exactly so commit copies it straight across.
- **`plannedAmount`** (`numeric(12,2)`) + **`plannedCurrency`** — **one** figure per
  person, compared against **`base` for `FULL_TIME` and `hourlyRate` for `HOURLY`**
  (`currentCompAmount` in the pure module is the single place that mapping lives;
  **bonuses are untouched**). The currency is stored, not assumed, so a CAD → USD
  move is expressible. `plannedAmount` is deliberately **not** seeded from current
  comp — pre-filling would make "not yet proposed" indistinguishable from "reviewed,
  deliberately no change".
- **`ratingDone` / `meetingDone` / `isComplete`** — workflow booleans, independent of
  content (a rating can exist before the meeting and vice versa).
- **`evaluationNotes` / `compensationNotes`**.
- **`snapshotAmount` / `snapshotCurrency` / `snapshotEmploymentType`** — frozen in the
  commit transaction; null while draft. The employment type is recorded because
  `plannedAmount`'s *meaning* depends on it — otherwise a years-old annual base could
  later be misread as an hourly rate.

### Pure module — `src/lib/performance/compensation-plan.ts`

Client-importable, no drizzle. Owns the status tuple + labels (feeding the pgEnum),
the display-currency modes, and the row math: `planChange` (the four money columns),
`currentCompAmount` / `compAmountLabel`, `monthsSince` + `NEW_JOINER_MONTHS` (the
tenure chip), `PLAN_LOCKED_MESSAGE`, and `COMPENSATION_PLAN_ACCESS`.

**The percentage change is invariant across display currencies by construction** —
`planChangePercent` computes from the **native** amounts, not the converted ones, so
switching the toggle re-denominates the money columns but can never move the
percentage. Cross-currency proposals convert both legs before subtracting.

### Access control — the conjunction of two existing capabilities (no matrix change)

Every plan surface (all three pages, the nav sub-item, and every action — three reads
+ six mutations) requires **both
`staff.viewCompensation` AND `ratings.edit`**, expressed once as the shared
**`COMPENSATION_PLAN_ACCESS: PermissionCheck`** constant so the actions, pages, and
nav entry can't drift. Better Auth's `authorize` **ANDs across resources**, so this
is a genuine conjunction — **`finance` (comp but not ratings) is denied**, leaving
manager/admin. **The permission matrix is unchanged.**

> **This surface is identity-bearing by design** — unlike `getCompensationSummaryData`
> / `getRatingsSummaryData`, whose anonymised rows exist because an *aggregate* comp
> view is bulk exposure. A plan names people by definition; the response was to raise
> the gate, not to pretend the rows could be identity-free. See
> [permissions.md](./permissions.md).

Defense in depth: all three pages `notFound()` unauthorized users (matching the hidden
nav item), `generateMetadata` on the detail route refuses to leak a plan's *name*
through the tab title, and every read/write re-checks server-side.

### Server layer (`src/actions/performance/`)

**Reads** (server-only, all `requirePermission(COMPENSATION_PLAN_ACCESS)`):

- **`getCompensationPlans`** — the list: name, status, effective date, headcount,
  creator, `committedAt`. **Carries no compensation figures** — a navigation surface
  doesn't need them.
- **`getCompensationPlan(planId)`** — the editor payload. Four queries, no N+1 (plan
  header; items joined to `staff`; every employment row for those staff; every rating
  row), folded in JS with `firstPerKey` and the new **`groupPerKey`**
  (`src/lib/core/collections.ts` — the sibling that keeps *all* rows per key, for
  "the latest row AND the one before it"; bound your input before calling). Each item
  carries three comp snapshots: **`current`** (the baseline the plan is written
  against — *live* while draft, the *frozen snapshot* once committed, so a committed
  plan's before/after never shifts), **`live`** (always current Rippling comp, what a
  committed plan reconciles against), and **`previous`** (the employment row before
  the current one — their last actual comp change). `monthsSinceJoin` is computed
  **server-side** (a client `new Date()` would mismatch on hydration).
- **`getStaffForCompensationPlan`** — the whole active roster for the membership
  page's client-side search/filters (hundreds of rows; same choice as the staff
  directory). **Deliberately carries no compensation** — it only identifies people.

**Mutations** — **six**, all `metadata.permission: COMPENSATION_PLAN_ACCESS`:
`createCompensationPlan`, `updateCompensationPlan` (rename + effective date, draft
only — the editor's Edit dialog), `deleteCompensationPlan` (the plans-list confirm),
`setCompensationPlanStaff`, `saveCompensationPlanItem`, `commitCompensationPlan`.
Shared server helpers live in **`compensationPlanWrites.ts`**:

- **`requireDraftPlan(planId)`** — every mutation re-reads status rather than trusting
  the client: a co-manager can commit while someone else has the editor open. Rejects
  with the shared `PLAN_LOCKED_MESSAGE` so the client can recognise *that* failure
  (retrying is pointless) apart from a network error (retrying is right).
- **`buildPlanItems`** — seeds new items from the person's current level + subratings
  (re-sanitized against their **current** role, since a stored rating may predate a
  role change) and their comp currency. `plannedAmount` stays null (see above).
  Unknown/inactive ids are dropped silently.
- **`planPaths`** — the paths every plan mutation revalidates.

**`setCompensationPlanStaff` is a set, not a delta.** Its input is `{ planId,
staffIds }` where `staffIds` is the **complete desired membership** — the action reads
what's stored, diffs, and applies the inserts and deletes in **one transaction**. An
empty list is legal and means "remove everyone". This replaced a separate
add/remove pair for two reasons: the membership page submits the whole checked set
anyway, so the diff belongs server-side where it can be **atomic**; and two people
reconciling membership concurrently then land a coherent set instead of interleaving
partial adds and removes. **Existing members are left completely untouched** — only
genuinely new ids are inserted (seeded by `buildPlanItems`) and only genuinely absent
ones deleted — so a member's proposed rating, planned figure and notes survive a
reconcile they weren't part of. Removing someone *does* discard their row (cascade),
which is why the UI confirms it. Returns `{ added, removed }` for the toast.

**`saveCompensationPlanItem` is the autosave endpoint** — it runs on every debounced
keystroke, tick and select change. It writes **only the fields present in `patch`**
(so concurrent edits to different fields of a row don't clobber each other), asserts
the item belongs to the named plan (an item id from another plan can't be reached by
naming one you *do* have access to), re-sanitizes subratings against the person's
current role, refuses an amount with no currency, and **deliberately does not
`revalidatePath`** — invalidating the route on every keystroke would re-render the
editor out from under the typist.

**`commitCompensationPlan`** — one transaction:

1. **Ratings written.** One new dated `staff_rating` row per **genuinely-changed**
   item, reusing `saveStaffEvaluation`'s hardening: subratings re-sanitized against
   each person's **current** role, no-ops dropped (untouched items were seeded from
   the current rating, so most of a large plan may legitimately write nothing),
   inactive/unknown staff **skipped rather than aborting** (the rest of the cohort's
   decisions still land), and an effective date that **predates anyone's latest
   rating is rejected by name** (it would file as history and never become current;
   equal dates are fine — `createdAt` breaks the tie). Rejecting rather than skipping
   is deliberate: the plan's date is editable, so it's actionable.
2. **Compensation snapshotted, not written.** Per item, freeze
   `snapshotAmount`/`snapshotCurrency`/`snapshotEmploymentType`.
3. Plan → `COMMITTED` + `committedAt` + `committedByUserId`.

Then revalidates `/performance` and `/performance/levels/edit` (new levels move the
dashboard distribution and the edit grid) plus the plan paths.

> **Shared rating-write hardening.** `sanitizeSubratings` and `canonicalSubratings`
> were extracted out of `saveStaffEvaluation.ts` into the pure
> `src/lib/performance/rating-rubric.ts` so the two rating-write paths share one
> implementation. **`staff_rating` now has two writers** — change the hardening in
> the pure module, never in one action.

### UI

**Three** routes: **`/performance/compensation-plans`** (list),
**`[planId]`** (editor), and **`[planId]/staff`** ("Plan staff" — the membership
roster); one sub-item under Performance in `nav.ts`, gated on
`COMPENSATION_PLAN_ACCESS`. Components in
`src/components/performance/compensation-plans/`.

- **`plans-list`** + **`new-plan-dialog`** — the list table (name link, effective
  date, headcount, status badge, creator), plus a per-plan delete affordance behind
  the shared `ConfirmDialog`.
- **`plan-editor`** — the client root: display-currency toggle, expanded-row set,
  autosave hook, Edit / **Manage staff** (a link, not a dialog) / Commit. **Not built
  on the shared `EditableTable`** — see [ui.md](../ui.md) → *Save-on-edit vs. batch
  edit* and *Expandable rows*. There is **no Save button**; a committed plan renders
  the same table read-only, as does a draft the server locked underneath the editor.
  Its empty state links to the membership page rather than opening a picker.
- **`edit-plan-dialog`** — rename + change the effective date, **draft only**
  (`updateCompensationPlan`).
- **`manage-plan-staff`** (on `[planId]/staff`) — the searchable/filterable checkbox
  roster over the preloaded active staff (search + line of business / role /
  employment type + select-all-matching), with a live "N to add · N to remove"
  counter. It submits the **entire checked set** through `setCompensationPlanStaff`
  and returns to the editor. **Membership deliberately lives on its own page, not in
  the editor:** keeping "who is in this round" separate from "what are we giving
  them" keeps the editor a pure comparison grid, with no destructive per-row control
  sitting next to the money columns — and it turns adding and removing into one
  reviewable change rather than a series of immediate side effects. It confirms
  before removing anyone whose row already holds work (a planned figure, either note,
  or any ticked checkbox), because removal discards the row. Read-only for a
  committed plan.
- **`plan-row`** + **`plan-expanded-panel`** — the row is Name · Rating · Current ·
  Planned · Change · Change % · three checkboxes · a trailing column carrying **only**
  the committed-plan **Applied / "Not applied · $X"** drift badge (its `plan-columns`
  key is `applied`; it no longer doubles as a remove slot). Cell contents are
  **vertically centred** — `TableCell`'s default `align-middle`, with no `align-top`
  overrides. The expanded panel holds tenure/join context (with a new-joiner chip),
  the person's **own role rubric** as subrating selects, the previous comp change, and
  the two notes — subratings live here rather than as columns precisely because the
  rubric is per-role, so a mixed-role plan can be scored in one pass (the edit-levels
  grid instead makes you filter to one role). The panel's stats strip is a
  `sm:grid-cols-2 lg:grid-cols-4` **grid** matching the subratings grid below it, and
  the "last evaluation" / "previous change" **dates are an `IconInfoCircle` tooltip,
  not inline text** — occasional context, and spelling them out made every fact
  ragged and two-line.
- **`planned-comp-field`** — the amount input + currency select. The planned amount is
  **the one money column never re-denominated** (it's an input); a muted `≈` echo
  carries the conversion when the row is displayed in another currency.
- **`commit-plan-dialog`** — surfaces the incomplete count; the editor `flushAll()`s
  and refuses to open it if anything is still unsaved.
- **`use-plan-autosave`** — one key per **(row, field)** over the shared
  `useAutosaveQueue`; discrete controls (selects, checkboxes) save immediately, text
  and numbers debounce; `flushRow` on collapse, `flushAll` before commit. A
  `PLAN_LOCKED_MESSAGE` response **abandons the queue** and refreshes into read-only,
  because retrying can never succeed.
- **`plan-columns`** / **`plan-format`** — the column list (declared once so the
  header row and the expanded panel's `colSpan` can't drift) and the change
  formatting/tone helpers.

### Tests — a deliberate ADR 0037 exception

`src/lib/performance/compensation-plan.test.ts` pins two invariants beyond the type
checker: the **percentage change is identical in every display currency**, and **every
missing/zero input yields `null`** rather than NaN/Infinity. Money-correctness rules a
type can't express — not a return to a broad suite; see
[ADR 0037](../decisions/0037-unit-tests-removed-except-rbac-matrix.md).

### Seed

`seedCompensationPlans` (`scripts/seed/performance.ts`, wired into `scripts/seed.ts`
**after `seedRatings`** since items seed their proposed level from the current one;
both tables added to `scripts/seed/wipe.ts`) creates **one draft + one committed
plan, 12 staff each**. The committed plan's planned figures deliberately differ from
live comp, so the frozen snapshot and the "Not applied" drift badge both have data.

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
  Ratings are keyed to `staff` (cascade) and shown only for **active** staff.
  Compensation plans read `staff_employment` heavily (current, previous, and live
  comp per person) but **never write it** — see
  [ADR 0046](../decisions/0046-compensation-change-plans-rating-writing-proposals.md).
  Future reviews would target a Person and may update role/seniority.
- **Rippling (external)** — the system of record for pay
  ([ADR 0020](../decisions/0020-compensation-effective-dated-import-only.md)). A
  committed compensation plan is a standing instruction *to* Rippling: the editor
  keeps comparing the proposal against live imported comp and badges each row
  **Applied** / **Not applied**.
- **Timesheets / Allocations** — utilization and delivery are intended review
  inputs (not yet wired).
- **Permissions** — `feedback.review` (manager + admin) is the reviewer tier; the
  Compensation dashboard reuses `staff.viewCompensation` (finance/manager/admin);
  the Performance (levels) dashboard + editor use `ratings.view` / `ratings.edit`
  (manager/admin **only** — not finance, no self-view), and its comp-by-level table
  additionally requires `staff.viewCompensation`; compensation plans require
  **both** `staff.viewCompensation` **and** `ratings.edit` (the strictest surface
  in the domain, and the only identity-bearing one). See
  [domains/permissions.md](./permissions.md).

## Open questions (for the proposed pieces)

- Review types: self / manager / 360, and how peer feedback feeds them.
- How tightly utilization factors into ratings (and who can see it).
- Cycle cadence; whether the peer-feedback rating scale is reused for reviews.
- Locking down reviewers seeing their own feedback (the deferred gap above).
</content>
</invoke>
