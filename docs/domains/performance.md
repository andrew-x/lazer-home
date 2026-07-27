# Domain: Performance management

**Status: partially built.** Three concrete slices are realized: **peer feedback**,
a **compensation & headcount analytics dashboard**, and **staff rating levels
(L0–L4)** — the latter two share the **single `/performance` dashboard** (levels
render as a section on that page, sharing its filter bar + currency toggle; there
are **no tabs** — see below). The broader review/goal machinery (ReviewCycle,
PerformanceReview, Goal) is still **proposed**.

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

## Compensation analytics dashboard — **built**

The first **analytics** slice: an authenticated page at **`/performance`** showing
workforce **compensation & headcount**, overall and **broken down by role**.
Metrics per group: headcount, average compensation, comp range (min/max), average
hourly rate, and hourly-rate range. Reads **no new table** — it aggregates the
latest `staff_employment` row per **active** staff member (the same
latest-row-per-staff pattern `getStaffDirectory` uses). **No charting library** —
KPI cards, a plain table, and a **hand-rolled inline-SVG scatter** (see below).

- **"Compensation" = `base + guaranteedBonus`** (excludes `discretionaryBonus`,
  which isn't imported yet). Hourly stats use the stored `hourlyRate` column.
- **Filters** (segmented controls, default "All"): line of business, employment
  type (`FULL_TIME` / `HOURLY`), and role. Applied client-side over the once-
  fetched rows.
- **Currency toggle (CAD / USD).** Comp is stored per person in their own
  currency; all amounts are normalized to the selected display currency via live
  FX rates. See [ADR 0029](../decisions/0029-external-fx-rates-and-currency-normalization.md)
  for the FX pattern (first live external API call — frankfurter.dev, USD
  cross-rate, never-throw fallback). When rates are stale the page shows a "rates
  unavailable" note.

### Access control — reuses `staff.viewCompensation` (no matrix change)

An aggregate comp view is **bulk comp exposure**, so it's gated by the **existing**
`staff.viewCompensation` capability (finance / manager / admin — the same gate on
individual comp; see [permissions.md](./permissions.md)). **The permission matrix
is unchanged.** Defense in depth: the page `notFound()`s unauthorized users
(matching the hidden nav item), and the read `getCompensationSummaryData` calls
`requirePermission(user, { staff: ["viewCompensation"] })` again server-side.

The nav item is **hidden** from users who lack the capability via the new
permission-aware sidebar mechanism (`NavItem.permission` → `visibleNavHrefs`; see
[ui.md](../ui.md) → *App shell & sidebar* and [architecture.md](../architecture.md)).

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
- UI: `src/app/(app)/performance/page.tsx` (server), `performance-dashboard.tsx`
  (client — filters, currency toggle, KPI cards, by-role table, distribution
  scatter), the reusable `stat-card.tsx` (a KPI tile extracted from the Home page's
  inline pattern), and `compensation-scatter.tsx` (the scatter, below).

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
rubric differs per role. **Effective-dated exactly like `staff_employment`
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
gates `metadata.permission: { ratings: ["edit"] }`, the pages `notFound()`, and the
`/performance` server page fetches `getRatingsSummaryData()` **only** for
`ratings.view` holders — passing it as the optional `ratingRecords` prop, so the
**Levels section is omitted entirely** for everyone else. Finance sees only the
compensation portion of the dashboard.

### Server layer (`src/actions/performance/`)

- **`getRatingsSummaryData`** (server-only read, `ratings.view`) — **anonymized**
  per-active-staff rows (`RatingRecord` = `CompensationRecord` + `level` +
  `subratings: Subratings | null`; no id/name/email — subratings carry no identity,
  only aggregated), for the dashboard. Latest employment row + latest rating row per
  active staff (two queries each, `firstPerKey`, no N+1). Exports `ratingsFilterOptions`.
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
  category's average taken over the people who scored it). The
  comp/rate-**per-level** table instead **reuses `computeByRole`** from
  `performance-stats.ts`, tagging the group key with the level label.
- Surfaced as a **section merged into the single `/performance` dashboard** (NOT a
  new route, NOT a tab, NOT a nav item — see below). `levels-section.tsx`
  (`LevelsSection`) renders: stat cards (average level / unrated), a hand-rolled SVG
  **bar chart** (`level-distribution-bar-chart.tsx`, **zero baseline**; see
  [ui.md](../ui.md) → *Charts*), a comp/rate-by-level table, an
  average-level-by-role table, and a **"Subratings by category" breakdown** — one
  small table per role (Category | Avg subrating | Rated), rendered only when there
  are scored subratings, from `computeAverageSubratingsByRole`. Like everything else
  on the dashboard it is **anonymized and filter-respecting** (subratings carry no
  identity — only aggregated). It is **presentational** — the parent
  `performance-dashboard.tsx` owns the filter + currency state and passes the
  already-chosen `lineOfBusiness` / `role` / `employmentType` / `currency` as props,
  so levels and compensation read from **one control bar** with the **same currency
  toggle + FX** ([ADR 0029](../decisions/0029-external-fx-rates-and-currency-normalization.md)).
  The edit page `/performance/levels/edit/page.tsx` → `edit-levels.tsx` reuses the
  shared `EditableTable`/`useEditableRows` batch pattern (a level dropdown per active
  staff, save-on-dirty bar, confirm-diff dialog) and offers **name search + role +
  line-of-business filters**; its "back" link points to `/performance`. It's reached
  from the **Performance sidebar submenu** ("Edit levels", gated on `ratings.edit`),
  not from a button on the dashboard — the former in-section "Edit levels" button was
  removed (see [ui.md](../ui.md) → *App shell & sidebar* → Submenus).
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

### One dashboard, no tabs

There is **no tab bar and no separate levels route**. `/performance` fetches
`getRatingsSummaryData()` only when the user holds `ratings.view` and hands it to
`PerformanceDashboard` as the optional `ratingRecords` prop; the dashboard renders
`<LevelsSection>` (after the compensation section, sharing its filter/currency
state) **only when that prop is present**. So managers/admins see comp **and**
levels on one page; finance sees comp only. The levels **analytics** have **no
separate sidebar entry** (they live inline on `/performance`); only the levels
**editor** is a sidebar link, as the "Edit levels" child of the Performance submenu
(`ratings.edit`-gated — see [ui.md](../ui.md)). (The earlier design — a cross-route `performance-tabs.tsx` bar and a
standalone `/performance/levels` dashboard — was removed; see
[ADR 0032](../decisions/0032-staff-rating-levels-effective-dated-manager-only.md).)

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
  Only **active** staff participate. The analytics dashboard reads the latest
  `staff_employment` compensation for every **active** staff member; ratings are
  keyed to `staff` (cascade) and shown only for **active** staff. Future reviews
  would target a Person and may update role/seniority.
- **Timesheets / Allocations** — utilization and delivery are intended review
  inputs (not yet wired).
- **Permissions** — `feedback.review` (manager + admin) is the reviewer tier; the
  comp dashboard reuses `staff.viewCompensation` (finance/manager/admin); the
  levels section uses the new `ratings.view` / `ratings.edit` (manager/admin **only**
  — not finance, no self-view). See [domains/permissions.md](./permissions.md).

## Open questions (for the proposed pieces)

- Review types: self / manager / 360, and how peer feedback feeds them.
- How tightly utilization factors into ratings (and who can see it).
- Cycle cadence; whether the peer-feedback rating scale is reused for reviews.
- Locking down reviewers seeing their own feedback (the deferred gap above).
</content>
</invoke>
