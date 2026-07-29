# Domain: Performance management

**Status: partially built.** Five concrete slices are realized: **peer feedback**,
a **compensation & headcount analytics dashboard**, **staff rating levels
(L0–L4)**, **compensation change plans**, and **performance review notes**. The
middle two dashboards are **two separate, separately-gated** routes —
`/performance/compensation` and `/performance/levels` — and **`/performance` itself
is not a page**: it's a permission-aware redirect to whichever dashboard the viewer
may see ([ADR 0044](../decisions/0044-performance-dashboards-split-by-permission.md);
they used to share one page, which [ADR 0032](../decisions/0032-staff-rating-levels-effective-dated-manager-only.md)
described — that framing is superseded). Plans live at
`/performance/compensation-plans` — the one identity-bearing *analytics-adjacent*
surface here
([ADR 0046](../decisions/0046-compensation-change-plans-rating-writing-proposals.md),
[ADR 0048](../decisions/0048-plan-editor-status-ladder-display-units-and-level-targets.md)).
**Review notes have no route of their own** — they live as a tab on the staff
profile and inside the plan editor's profile drawer, and they are the **one place in
the whole codebase where authorization reads the reporting line**
([ADR 0049](../decisions/0049-review-notes-reporting-line-as-authorization-boundary.md)).
The rest of the review/goal machinery (ReviewCycle, PerformanceReview, Goal) is still
**proposed**.

> **Read this first if you're touching gates here.** This domain now holds **three
> different kinds of gate**, and they are not interchangeable: a plain capability
> (`feedback.review`, `ratings.*`), a **conjunction** of two capabilities
> (`COMPENSATION_PLAN_ACCESS`), and a **relationship** (`staff.managerId`, review
> notes only). See [permissions.md](./permissions.md).

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
   any id — the detail page `/feedback/[id]`), plus **two** browse surfaces, both on
   that same unchanged capability: **their own direct reports** ("Your reports" tab,
   `getFeedbackAboutReports` — see below) and **any one named person**
   (the staff-profile **"Peer feedback" tab**, `getFeedbackAboutStaff` — see below).
   A **browse-all list** of *everyone's* feedback is still **deferred / planned** —
   it existed briefly (`getAllFeedbackPage` + an `all-feedback-table`) and was
   removed; the two tabs reinstate that idea only in narrowed forms (a reporting
   subtree; one person at a time). The `feedback.review` capability itself is
   unchanged and still the only reviewer gate
   ([ADR 0047](../decisions/0047-feedback-reports-scoping-not-granting.md),
   [ADR 0050](../decisions/0050-profile-peer-feedback-tab.md)).

> **"Manager" in the *feedback* authorization model still means the `feedback.review`
> capability, never a reporting line** — no feedback read consults the reporting graph
> to decide *whether* you may see something. The graph itself
> (`staff.managerId`, a durable self-FK,
> [ADR 0026](../decisions/0026-staff-manager-self-reference.md)) is **read to scope**
> the "Your reports" tab: scoping ≠ granting, so the tab's gate is the plain
> capability and the relationship only *narrows* a set the caller was already entitled
> to see in full. **Do not generalise that to the codebase.** Since
> [ADR 0049](../decisions/0049-review-notes-reporting-line-as-authorization-boundary.md),
> **performance review notes** (below) *do* let `managerId` decide access — the one
> exception, in one module. (Older docs asserting "there is no manager/report graph in
> this codebase" are wrong — that was true before ADR 0026.)

### "Your reports" — the one relationship-scoped browse list

The third tab on `/feedback` (after "About you" and "You've given"), backed by
**`getFeedbackAboutReports`** (`src/actions/feedback/`, server-only read). It lists
feedback whose **recipient is a direct report of the caller** — newest first, with
**full content**, opening in the shared detail dialog. Load-bearing details:

- **Gate: `userHasPermission(user, { feedback: ["review"] })`** — the *same*
  capability `getFeedbackDetail` already requires. Every row listed is therefore one
  the caller could already open in full at `/feedback/[id]`. This is a **browse
  surface over existing authorization**, not a new tier: the reporting line only
  *narrows*, never grants. **No matrix change** — `permissions.ts`, the matrix test
  and [permissions.md](./permissions.md) are untouched.
- **Direct reports only, one hop** — `staff.managerId = caller's staff id`. **No
  recursion**, so a skip-level report doesn't appear. (Not a security property, just
  the chosen scope; widening it would still be inside the same capability.)
- **`null` vs `[]`** — `null` means "not permitted, or the caller has no linked
  active `staff` row", and the page **hides the tab entirely**; `[]` means
  "permitted, nothing to show" and renders an empty state. Keep that distinction —
  collapsing them would either leak the tab's existence or hide it from an
  entitled manager with no feedback yet.
- **Self-exclusion is deliberate:** the query also `ne(recipient.id, callerStaffId)`.
  `managerId` is CSV-import-populated with **no in-app editor** and has no cycle
  guard beyond the importer's `self` warning, so a row pointing at itself is
  possible — without the guard it would hand the caller *their own* feedback in
  full, the exact thing the recipient tier withholds. (The reviewer self-view gap
  below still exists via `/feedback/[id]`; this guard just refuses to widen it into
  a list.)

Full rationale in
[ADR 0047](../decisions/0047-feedback-reports-scoping-not-granting.md).

### "Peer feedback" on the staff profile — the per-person surface

A second browse surface, on the **same unchanged capability**: a **Peer feedback tab**
on `/staff/[id]`, `/profile`, and the compensation-plan **profile drawer**, backed by
**`getFeedbackAboutStaff(staffId)`** (`src/actions/feedback/`, server-only read). It
returns a **two-tier tagged union**, and *the branch order is the decision*
([ADR 0050](../decisions/0050-profile-peer-feedback-tab.md)):

1. **Self is checked FIRST → `{ tier: "recipient", rows }`.** On your own profile you
   get the limited recipient projection (it delegates to `getFeedbackAboutMe`) **even
   if you hold `feedback.review`**. A deliberate **tightening**: it refuses to widen
   the reviewer self-view gap below into a browsable list. Flip the order and the
   tightening is gone.
2. **Someone else's profile + `feedback.review` → `{ tier: "full", rows }`** — the
   same projection `getFeedbackDetail` gives a reviewer, so **every row is one the
   caller could already open at `/feedback/[id]`**. This adds **discovery** (any
   person, one at a time), **not access** — no new capability, no matrix change, and
   **browse-all is still deferred**.
3. **Anyone else → `null`**, and no tab is rendered at all (not the trigger, not the
   panel), so the tab's presence never discloses that feedback exists. Same
   `null` vs `[]` convention as the reports tab.

UI: **`src/components/feedback/staff-feedback-panel.tsx`** (client, presentational —
takes `view` + `staffName`, holds no reads) so all three hosts can't drift. It reuses
`FeedbackAboutMe` for the recipient tier and the shared `FeedbackDetailDialog` for the
full tier, supplying `recipientName` from `staffName` (a per-person read has no reason
to repeat the recipient on every row). It **says which tier the viewer is in** out loud
("As a reviewer you can see each item in full — they can't"), and links out to
`/feedback`.

### Deliberate gap — reviewers see their own feedback

`feedback.review` currently grants a reviewer full visibility of **any** feedback,
**including feedback about themselves** (`getFeedbackDetail` does not exclude the
reviewer as recipient). This is a **known,
accepted limitation for the first slice**, not an oversight — locking down
managers reading their own feedback (e.g. routing it through the limited recipient
view) is flagged **future work**. See [ADR 0023](../decisions/0023-feedback-privacy-tiers.md).

**Both browse surfaces refuse to widen it** — the reports tab excludes the caller as
recipient, and the profile tab returns the *recipient* tier on your own profile. So the
gap is reachable **only** via `/feedback/[id]`. Keep it that way: any new
reviewer-facing feedback surface should route the caller's own rows through the
recipient projection.

### Actions & UI

- Actions in `src/actions/feedback/`: `createFeedback` (+ `.schema`),
  `authorizeFeedback` (`canGiveFeedback` + `authorizeFeedbackCreate`),
  `getFeedbackAboutMe`, `getFeedbackIGave`, `getFeedbackDetail`,
  **`getFeedbackAboutReports`** (the reviewer's direct-reports list — above),
  **`getFeedbackAboutStaff`** (the per-person profile tab — above),
  `searchStaffForFeedback` (auth-only recipient picker, active staff excluding
  self — no capability, since giving is open).
- UI: nav item **"Peer Feedback"** → `/feedback` (`IconMessageHeart`; the route and
  its children are unchanged — only the label and the page `<h2>`/`metadata.title`
  say "Peer Feedback"). Pages: `src/app/(app)/feedback/page.tsx` (a **three-tab**
  view — "About you" / "You've given" / **"Your reports (N)"**, the last rendered
  only when `getFeedbackAboutReports` returns non-`null`),
  `feedback/new/page.tsx` ("Give feedback" — the **dedicated give-feedback page**),
  and `[id]/page.tsx` ("Feedback detail"). Components under
  `src/components/feedback/`: `feedback-form` (the give-feedback form, rendered on
  the `/new` page — replaced the old dialog), `feedback-about-me`,
  `feedback-given-table`, **`feedback-about-reports-table`**,
  **`staff-feedback-panel`** (the profile/drawer tab — above),
  **`feedback-detail-dialog`** (the full-content dialog, **extracted from
  `feedback-given-table` and now shared by both tables and the profile panel** —
  change it in one place;
  callers keep `item` and `open` in separate state so the content survives the close
  animation), and `feedback-detail-fields` (a single item's full content, shared by
  that dialog and the `[id]` detail page). Vendored primitive
  `src/components/ui/radio-group.tsx` (Base UI `Radio`/`RadioGroup`) for the rating
  picker. The recipient tab warns that only the message-to-recipient is visible; the
  reports tab says the reverse out loud ("you can see each item in full — they
  can't"); the detail page gates full content via `getFeedbackDetail`.
- **The reports table filters in memory** (For / Author / From / To over the
  once-fetched rows, via the shared `SearchableSelectFilter` + `DatePicker`) — the
  **staff-directory** pattern, *not* the URL-backed [list filter bar](../ui.md#list-filter-bars).
  Deliberate: the controls sit inside an **uncontrolled `Tabs`**, so URL-backed
  filters would force tab selection into the URL too, and one manager's reports is a
  small set. The date filter compares `formatIsoDate(createdAt)` strings so it agrees
  with the Date column (`createdAt` is a timezone-less timestamp); the two endpoints
  can't cross (setting one past the other clears the other).

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
each person a proposed rating (level + subratings), a proposed compensation figure, a
**workflow status** (one ordered ladder — see below), and two note fields. **Committing
a plan writes the ratings as each person's latest `staff_rating` — and deliberately
does NOT write compensation.** Rippling remains the sole writer of `staff_employment`
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
- **`status`** — how far the review conversation has got, as **one ordered ladder**
  (`compensation_plan_item_status` pgEnum: `NOT_STARTED` → `RATING_DONE` →
  `MEETING_DONE` → `COMPLETE`; values in the pure module below, per
  [ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md)),
  rendered as a four-segment control. **This replaced three independent booleans**
  (`ratingDone`/`meetingDone`/`isComplete`), which cost three columns to say one thing
  and made nonsense states representable ("complete" for someone never rated).
  `drizzle/0010` backfills highest-set-flag-wins, `0011` drops the columns — a
  **deliberately lossy** migration, since eliminating those combinations was the point.
  See [ADR 0048](../decisions/0048-plan-editor-status-ladder-display-units-and-level-targets.md).
- **`evaluationNotes` / `compensationNotes`**.
- **`snapshotAmount` / `snapshotCurrency` / `snapshotEmploymentType`** — frozen in the
  commit transaction; null while draft. The employment type is recorded because
  `plannedAmount`'s *meaning* depends on it — otherwise a years-old annual base could
  later be misread as an hourly rate.

### Pure modules — `compensation-plan.ts`, `compensation-unit.ts`, `compensation-targets.ts`

All three under `src/lib/performance/`, client-importable, no drizzle.

- **`compensation-plan.ts`** — the plan + item status tuples and labels (feeding both
  pgEnums; the item ladder also has a **short** label map `—`/`Rating`/`Meeting`/`Done`
  for the in-cell segments), the display-currency modes, and the row math:
  `planChange` (the money columns), `currentCompAmount`, `monthsSince` +
  `NEW_JOINER_MONTHS` (the tenure chip), `PLAN_LOCKED_MESSAGE`, and
  `COMPENSATION_PLAN_ACCESS`.
- **`compensation-unit.ts`** — a flat **`HOURS_PER_YEAR = 2080`** and the annual↔hourly
  conversion behind the editor's **per-row display-unit toggle**. Deliberately a flat
  constant, **not** each person's `utilizationTarget`: this is a display convention, not
  a costing model, and a per-person factor would make the same figure convert to a
  different number per person. **The persisted value never moves** — the draft keeps
  `plannedCanonical` (the truth, in the person's own unit), `plannedText` (the editing
  buffer, in the displayed unit) and `plannedUnit` (display state no patch reads) apart,
  so toggling re-derives from the untouched canonical amount and enqueues no save.
  Converting the on-screen text instead would compound rounding and silently save a
  figure nobody touched — asserted in `compensation-unit.test.ts`.
- **`compensation-targets.ts`** — code-owned **compensation targets keyed role ×
  `billableType` × level**, one annual-CAD figure each, driving the editor's **Gap** and
  **Gap %** columns. Policy revised by human judgement, so it's a reviewed diff rather
  than a migration (same reasoning as the role rubrics,
  [ADR 0042](../decisions/0042-per-role-subratings-app-owned-jsonb.md)). **The shipped
  figures are placeholders and only `ENGINEER` is configured** — every other role renders
  an em dash, never a zero. Nothing here writes pay
  ([ADR 0020](../decisions/0020-compensation-effective-dated-import-only.md) stands).

Full rationale for all three in
[ADR 0048](../decisions/0048-plan-editor-status-ladder-display-units-and-level-targets.md).

**Percentages are invariant across the display toggles by construction** —
`planChangePercent` and Gap % compute from the **native** amounts, cross-rated through
USD, so switching currency *or* unit re-denominates the money columns but can never move
a percentage. Cross-currency proposals convert both legs before subtracting. Every
signed cell also **rounds to its display precision before choosing a sign**, so an FX
residue like `-2.9e-11` renders as a neutral `CA$0`, not a destructive-red `−CA$0`
(pinned in `plan-format.test.ts`).

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
- **`plan-editor`** — the client root: display-currency toggle, search + filters +
  hand-rolled sorting, expanded-row set, autosave hook, the mounted-once **profile
  drawer** (below), Edit / **Manage staff** (a link, not a dialog) / Commit. **Not built
  on the shared `EditableTable`** — see [ui.md](../ui.md) → *Save-on-edit vs. batch
  edit* and *Expandable rows*. There is **no Save button**; a committed plan renders
  the same table read-only, as does a draft the server locked underneath the editor.
  Its empty state links to the membership page rather than opening a picker. Each row's
  money math is derived **once** as a `PlanRowView` (`plan-row-view.ts`) shared by the
  cells and the sort comparator — two independent derivations of FX-and-unit-converted
  money would drift ([ADR 0048](../decisions/0048-plan-editor-status-ladder-display-units-and-level-targets.md)).
  The page also drops the app's usual `max-w-[90rem]` measure and pins itself to
  `100svh` with the table pane owning the scrolling (eleven dense numeric columns are
  read *across*, and the sort controls have to stay put).
- **The read-only profile drawer** (`StaffProfileDrawer`, `src/components/staff/`) —
  clicking a **person's name** in a row opens it, so a reviewer can check who they're
  deciding about without leaving the grid. Mounted **once for the whole table**
  (`profileStaffId` + `profileOpen` state on the editor — kept as two pieces of state so
  the id survives the close animation); a per-row drawer would duplicate fetches and
  state. The name button is deliberately **not** the expand toggle — the chevron stays
  the only expand affordance, so one click never means two things. See
  [staff-profiles.md](./staff-profiles.md) and [ui.md](../ui.md).
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
  or any status past `NOT_STARTED`), because removal discards the row. Read-only for a
  committed plan.
- **`plan-row`** + **`plan-expanded-panel`** — the row is **Name** (a button opening the
  profile drawer) · Rating · Current · Planned · Change · Change % · **Gap** · **Gap %**
  · **Status** (the four-segment ladder) · a trailing column carrying **only**
  the committed-plan **Applied / "Not applied · $X"** drift badge (its `plan-columns`
  key is `applied`; it no longer doubles as a remove slot). Gap columns carry **no
  colour** — being above a level's target is information to notice, not a problem to
  flag. Cell contents are
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
  formatting/tone helpers (`changeTone` takes an **already-display-rounded** value, via
  `displayedAmount`/`displayedPercent`, so colour and text can't disagree).
- **`plan-toolbar`** / **`plan-view`** / **`plan-row-view`** — the search + filter +
  sort controls, the view/sort state, and the per-row derived money. **Sorting is
  hand-rolled** (the shared `EditableTable`/TanStack renders one `<tr>` per row and this
  table needs two for the expanded panel), reusing the header button from
  `@/components/form/sort-header`. The **Status filter matches the live draft value**,
  not the last-saved one — everything else in the grid is draft-driven — so advancing a
  filtered row's status drops it out of view, which is the honest reading of "show me
  everyone still at Rating done". Filtering unmounts rows, so the editor prunes hidden
  ids from its expanded set and flushes them fire-and-forget.

### Tests — a deliberate ADR 0037 exception

Three test files pin money invariants beyond the type checker:
`compensation-plan.test.ts` (the **percentage change is identical in every display
currency**; every missing/zero input yields `null` rather than NaN/Infinity),
`compensation-unit.test.ts` (round-tripping the *displayed* text would silently edit the
persisted figure — the rejected alternative in
[ADR 0048](../decisions/0048-plan-editor-status-ladder-display-units-and-level-targets.md)),
and `plan-format.test.ts` (a difference that displays as zero is unsigned and
neutral-toned). Money-correctness rules a type can't express — not a return to a broad
suite; see [ADR 0037](../decisions/0037-unit-tests-removed-except-rbac-matrix.md).

### Seed

`seedCompensationPlans` (`scripts/seed/performance.ts`, wired into `scripts/seed.ts`
**after `seedRatings`** since items seed their proposed level from the current one;
both tables added to `scripts/seed/wipe.ts`) creates **one draft + one committed
plan, 12 staff each**. The committed plan's planned figures deliberately differ from
live comp, so the frozen snapshot and the "Not applied" drift badge both have data.

## Performance review notes — **built**

A **review note** is a manager's dated write-up of a review conversation with one of
their people. It is the first real piece of the review machinery, and it is unlike
everything else in this domain: **who may read it depends on the reporting line
(`staff.managerId`), not on a role capability.** That is deliberate, it is the only
place in the codebase where the reporting graph is an authorization *input*, and it
breaks an invariant [ADR 0047](../decisions/0047-feedback-reports-scoping-not-granting.md)
stated explicitly — full rationale in
[ADR 0049](../decisions/0049-review-notes-reporting-line-as-authorization-boundary.md).

Two-step lifecycle: a manager writes a **`DRAFT`** (only they and admins can see it),
then **`SHARED`** makes it visible to the person it's about. **Sharing is one-way —
there is no un-share** (the person may already have read it, so hiding it again would be
theatre). **Deleting is the retraction path**, which is why deletion is allowed in both
states.

### Entity — `performance_review_note` (`src/lib/db/performance-schema.ts`)

`drizzle/0012_far_black_cat.sql`. **Not effective-dated** — a note is a *document*, not
a fact about a person, the same reasoning as `compensation_plan`
([ADR 0007](../decisions/0007-staff-employment-effective-dating.md) doesn't apply).

- **`staffId`** — who the note is about; FK → `staff.id`, **cascade** (a note is
  meaningless without the person). Indexed (`performance_review_note_staff_idx`).
- **`authorUserId`** — FK → `user.id`, **`set null`**. Audit *and* an authorization
  input (see the author path below). `set null` **fails closed**: losing the author row
  narrows access to manager/admin, never widens it — a null author is a legitimate
  state, not corruption.
- **`noteDate`** — `date` (string mode): the date of the **conversation**, not of typing.
- **`title`** (nullable) / **`body`** (required free text).
- **`status`** — `performance_review_note_status` pgEnum (`DRAFT` | `SHARED`, default
  `DRAFT`). Values live in the pure module below, per
  [ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md).
- **`sharedAt`** — null while draft. Set on share, and the `status = 'DRAFT'` predicate
  in the share `where` clause is the **idempotency guard** (same shape as
  `compensationPlan.committedAt`): a second share matches no row and errors instead of
  silently re-stamping.

### Pure module — `src/lib/performance/review-note.ts`

Client-importable, no drizzle. Owns the status tuple (feeding the pgEnum) + labels, the
max lengths (`REVIEW_NOTE_TITLE_MAX` 200, `REVIEW_NOTE_BODY_MAX` 20 000), and the copy
that has to be identical everywhere: `REVIEW_NOTE_SHARE_WARNING` and
`REVIEW_NOTE_DRAFT_HINT`. **The access decision is *not* here** — it needs the db.

### Access control — the reporting line, not a capability (NO matrix change)

**`src/actions/performance/reviewNoteAccess.ts` is the one place `staff.managerId`
decides access.** Read it before touching anything in this section.

`getReviewNoteAccess(user, staffId)` → `{ callerStaffId, isSubject, canManage }`:

- **`canManage`** = `isAdmin(user)` **OR** the caller's linked staff id equals the
  subject's **current** `staff.managerId`. Draft/edit/share/delete — and reading drafts
  — all hang off it.
- **Role capabilities are not consulted at all.** Holding `ratings.edit` or
  `feedback.review` grants **nothing** here; being the person's manager does. Only
  `admin` is a blanket override.
- **The subject gets `isSubject` and nothing more** — `SHARED` notes only, never drafts,
  never a management affordance. **The self path returns before `managerId` is even
  read**, a stronger form of ADR 0047 §4's self-exclusion: a self-pointing `managerId`
  (reachable through a bad CSV) can't make someone their own note-manager and hand them
  their own drafts.
- **The caller must be an *active* linked staff member** — `ownStaffId(user.id, {
  activeOnly: true })`, so an unlinked *or* inactive caller has no reporting line to
  stand on and gets nothing (and, being resolved to `null`, isn't even the subject of
  their own notes). **This is load-bearing, not defensive tidiness:** a terminated
  person keeps a valid session until it expires, and their former reports' `managerId`
  still points at them **until the next CSV import** — without `activeOnly` they could go
  on reading *and writing* private notes about those people through a direct action call.
  The `(app)` layout refuses them, but **an action isn't reached through the layout**, so
  the gate has to say so itself. Same reasoning as `canGiveFeedback`.
  - **Contrast `canEditStaff` / `canViewCompensation` / `canEditTimesheet`, which
    deliberately *don't* pass `activeOnly`** — and pick the variant consciously when you
    add an action. The rule of thumb: **an ownership check** resolves the caller only to
    compare against *their own* row, so a stale-active caller reaches nothing but
    themselves; **a relationship or eligibility check** (this gate, `canGiveFeedback`,
    `loadStaffProfileDrawer`) uses the caller's identity to reach **other people's**
    data, and there `isActive` is part of "are you still one of us".

**Two `ActionAuthorize` hooks are the real boundary** — declared in `metadata`, enforced
before every body ([permissions.md](./permissions.md)); the `canManage` flags in the read
are UI affordances only:

- **`authorizeReviewNoteCreate`** gates on `clientInput.staffId`. Contract: the action
  must take a `staffId: string`.
- **`authorizeReviewNoteMutate`** gates on `clientInput.noteId`, resolving the subject
  **and** author server-side — the client never says who a note is about. A **missing
  note denies with the same message as a forbidden one**, so ids can't be probed.
  Contract: the action must take a `noteId: string`.
  - **The author path lives here:** whoever wrote a note may fix or delete it even after
    they stop being that person's manager. Otherwise a manager who changes teams strands
    their own words — unreachable to correct, unreachable to retract.
  - **It survives a team change, not a departure.** The hook calls
    `getReviewNoteAccess` **first**, returns on `canManage`, and only then applies the
    author path as **`callerStaffId !== null && note.authorUserId === user.id`**. Since
    the access read resolves `callerStaffId` with `activeOnly`, that one condition is the
    author path *and* the still-employed check. "Changed teams" and "left the company"
    are different things: the path was never meant to let someone who has left reach back
    in and **delete** the record of a review conversation — and termination here is a CSV
    import flipping `isActive`, which does **not** revoke their session.
  - **Note the key mismatch, because it is what hid the gap:** the author path is keyed
    on **`user.id`** (a note's author is a user account, not a staff row) while the
    employment check is keyed on the **staff row**. An early `return` on
    `authorUserId === user.id` therefore looked complete while silently skipping the
    employment check entirely. **So the rule is now uniform: apart from `admin`, every
    review-note path requires an active linked staff row.** If you add a fourth path,
    make it satisfy that too rather than short-circuiting ahead of the access read.

**Consequences to keep in mind:** `managerId` is CSV-import-populated with **no in-app
editor** and no cycle detection beyond the importer's non-blocking `self` warning
([ADR 0026](../decisions/0026-staff-manager-self-reference.md)), so a bad import now
changes who can **read and write** private notes — the importer's
"unresolvable/column-absent → preserve, blank cell clears" rule is load-bearing. Access
follows the **current** line (no as-of resolution): a manager who moves teams keeps only
what they authored, and the new manager inherits the whole history including their
predecessor's notes. **The permission matrix, its test, and permissions.md's matrix table
are unchanged** — this gate isn't expressible as a matrix row, which is the point;
permissions.md carries a prose section instead.

### Server layer (`src/actions/performance/`)

- **`getStaffReviewNotes(staffId)`** (server-only read) → `{ canCreate, isSubject, notes }
  | null`. **Three projections, and the projection is the boundary:** manager/admin →
  every note incl. drafts; the **subject** → `status = 'SHARED'` only; otherwise → the
  caller's **own authored rows** (an ex-manager who moved teams, matched on
  `authorUserId = user.id`). Newest first by `noteDate` then
  `createdAt`; `authorName` from a left join on `user` (null when the account is gone).
  Each row carries **`canManage`** for the UI affordances. **Two `null` exits, both
  meaning "no tab at all":** an **early** one before the query — `!canManage &&
  !isSubject && callerStaffId === null`, so an inactive or unlinked non-admin caller is
  refused without even reading their authored rows, matching the mutate hook — and one
  after it, when a permitted-in-principle caller simply has no rows here. `[]` means
  "permitted, nothing written yet" (the ADR 0047 §5 convention — a tab that appeared for
  everyone would itself disclose that notes exist).
- **Four mutations**, all `secureActionClient` with the gate in **metadata only**:
  - **`createReviewNote`** — born `DRAFT`, `authorUserId` from the session, id prefix
    `prn`.
  - **`updateReviewNote`** — content only, allowed in **both** states (a shared note can
    be corrected; the panel marks it "edited" when `updatedAt > createdAt`). Never
    touches `status` / `staffId` / `authorUserId`.
  - **`shareReviewNote`** — the one-way transition, `and(id, status = 'DRAFT')` as the
    idempotency guard. Status is re-read from the DB, never trusted from the client.
  - **`deleteReviewNote`** — both states, because it *is* the retraction path.
  - All four `revalidateStaffProfile(staffId)`.
- **`reviewNotes.schema.ts`** — one **family module** for all four (the
  `entries.schema.ts` precedent), hand-written/drizzle-free because the client panel
  imports it ([ADR 0035](../decisions/0035-schema-modules-by-import-boundary.md)). It
  also exports `reviewNoteContentSchema` + its input/output types, used as the panel's
  resolver. **Note what is *not* in it: `status`.** It is absent from every input schema,
  so the lifecycle can't be skipped by posting a status.

### UI

**No route of its own.** `ReviewNotesPanel`
(`src/components/performance/review-notes-panel.tsx`, client) renders as a **Review
notes tab** on `/staff/[id]`, `/profile`, and inside the compensation-plan **profile
drawer**. Newest-first list, a `Draft` badge, per-note **Share** (behind `ConfirmDialog`
with the shared warning copy) / **Edit** / **Delete**, and an inline composer/editor.
It renders only the affordances the server told it about — never its own permission logic.

- **Discrete saves, not the autosave queue.** Each action toasts; there is no
  `SaveIndicator` and no `useAutosaveQueue`. Deliberate: a note is submitted as a whole
  thought, and a half-written draft autosaving into a shareable row is the wrong default.
  See [ui.md](../ui.md) → *Save-on-edit vs. batch edit*.
- **`onChanged` instead of `router.refresh()`.** Server-rendered hosts get
  `revalidatePath` from the actions plus a `router.refresh()`; the **drawer** passes
  `onChanged` so it re-loads *itself* — refreshing the route would re-render the plan
  editor underneath, mid-edit.
- **The composer/editor uses loose form binding** (`useForm` + `useAction`, not
  `useHookFormAction`) because the form shape deliberately omits the ids the actions need
  — plus RHF's third "transformed values" generic, so `handleSubmit` already receives
  exactly what the actions take (trimmed, blank title → `null`). Create takes a
  `staffId`, edit takes a `note`, as a **union** rather than two optional props, so
  "neither" can't be constructed. See `.claude/rules/forms.md`.

### Seed

**`seedReviewNotes`** (`scripts/seed/performance.ts`, wired into `scripts/seed.ts` after
`seedCompensationPlans`; the table added to `scripts/seed/wipe.ts`) gives ~60% of active
staff who have a manager **1–3 dated notes**, attributed to that manager, all `SHARED`
except sometimes the most recent (a `DRAFT`, so the manager view has something only they
can see). It applies the **same self-guard** as the reads. ~38 rows.

> **`authorUserId` is null for most seeded rows, and that's correct.** `seedStaff` links
> a `user` account to exactly one staff row (the admin), because accounts only exist for
> people who have signed in. A null author models the `set null` state the schema allows
> — still readable through the reporting line, just with no author name and no author
> path. Don't "fix" it by inventing accounts.

## Still proposed

- **ReviewCycle** — a period in which reviews happen (quarterly, annual). Review notes
  (above) are standalone documents with no cycle attached — a cycle would group them.
- **PerformanceReview** — a Person's assessment within a cycle; may pull in project
  work and utilization.
- **Goal** — an objective for a Person, tracked over time.

Proposed flows: review cycle (open → collect self/manager/peer input → assess →
close), goal setting & tracking, and an evidence pull surfacing allocations,
utilization, and project contributions as review context.

## Connects to

- **Staff profiles** — feedback is staff↔staff; both endpoints are `staff` rows.
  Only **active** staff participate. **`staff.managerId` (the import-populated
  "reports to" self-FK, [ADR 0026](../decisions/0026-staff-manager-self-reference.md))
  is read here, in two escalating ways** — `getFeedbackAboutReports` **scopes** with it
  (its first non-display consumer, and the first query in the *inverse* direction "who
  reports to me"), and `reviewNoteAccess` **gates** with it. So a bad import now changes
  what a manager can read *and write*, not just a profile line. **This domain also owns
  two of the profile's tabs** — Peer feedback and Review notes — each rendered only when
  its read came back non-null, which is why the **profile tab set is viewer-dependent**
  (see [staff-profiles.md](./staff-profiles.md)). Both analytics
  reads join the latest
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
- **Permissions** — `feedback.review` (manager + admin) is the reviewer tier, and the
  **only** feedback gate: both browse surfaces (the "Your reports" tab and the
  per-person profile tab) sit *inside* that capability rather than adding one
  ([ADR 0047](../decisions/0047-feedback-reports-scoping-not-granting.md),
  [ADR 0050](../decisions/0050-profile-peer-feedback-tab.md)). **Review notes are the
  exception to the whole model** — gated on the **reporting line**, with no capability
  involved and no matrix row
  ([ADR 0049](../decisions/0049-review-notes-reporting-line-as-authorization-boundary.md)); the
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
- Whether **review notes** should attach to a cycle (and whether a skip-level or an HR
  role should read them — today only the direct manager and admins can, by design).
- Whether the reporting line as a gate deserves a first-class abstraction, if a
  **second** entity ever needs it ([ADR 0049](../decisions/0049-review-notes-reporting-line-as-authorization-boundary.md)).
</content>
</invoke>
