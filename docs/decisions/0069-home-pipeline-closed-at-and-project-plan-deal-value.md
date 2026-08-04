# 0069 — The sales pipeline on the home dashboard: a `closedAt` column, and deal value borrowed from the project plan

**Status:** accepted · 2026-08-04 ·
**amends [ADR 0063](./0063-home-dashboard-two-time-bases-and-point-in-time-staffing.md) twice** —
its §1/§2 "Lazer Status is point in time" (that band now carries a windowed block, symmetric
with what [ADR 0065](./0065-home-personal-task-list-and-assignee-completion.md) did to Your
Status) and its §6 "one filter, one meaning" (the line-of-business control now also matches a
*deal's* own line of business) ·
**inherits [ADR 0066](./0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md) §7/§8**
(snapshotted rates, revenue ungated) and
[ADR 0053](./0053-project-plan-revenue-cost-and-margin.md) §7 (cost gated, revenue not) ·
**relies on [ADR 0024](./0024-opportunity-project-link-inverted.md)**'s many-opportunities →
one-project link, which is the source of §4's honesty problem ·
**schema: one nullable column, one CHECK, one index** (`drizzle/0028_woozy_killmonger.sql`) ·
**no permission-matrix change**

## Context

The home dashboard answered two questions — how *you* are doing (Your Status, year to date
from submitted timesheets) and how the *bench* is doing (Lazer Status, point in time from the
`project_roles` plan). Neither said anything about whether work is **coming in**. A staffed
bench with an empty pipeline and an idle bench with a full one rendered identically.

The ask was concrete: open-deal counts by funnel band, deal sizes for the bands where work has
been scoped, and closed-won/closed-lost counts for this week and this month — company-wide and
for the deals you personally own.

Two things blocked a literal reading, and both shaped the design.

## Decision

### 1. `opportunities.closedAt`, because close timing was not derivable

`opportunities` carried `createdAt` and `updatedAt` and nothing else. There is **no status
history anywhere** in the system: `opportunityEntries` are hand-written notes, nothing
auto-logs a transition, and there is no audit table.

`updatedAt` is an unsound proxy, not merely an approximate one. It is bumped by *any* write —
so renaming a deal won last year, or dragging its card to a different spot **inside** the Won
column, would file it as won this week. The figure would silently drift toward "whatever we
touched recently".

So: a **nullable `closedAt` timestamp**, deliberately *not* a general `statusChangedAt`.
`updatedAt` already answers "when did anything change"; the only question that needs a new
column is the close-specific one.

Three things enforce it rather than one:

- **`opportunities_closed_at_shape`** — a CHECK that `closedAt` is non-null exactly when the
  status is terminal, following the `projects_budget_shape` precedent. This is what turns a
  forgotten writer into a 500 instead of a skewed figure.
- **`closedAtFor`** (`src/lib/crm/opportunity-close.ts`) — a pure four-way transition table,
  returning an explicit value in *every* case so a caller can't leave the column untouched.
  Its unit test walks all 14 × 14 ordered status pairs and asserts non-null iff the next
  status is closed — the CHECK restated in TypeScript, so the two representations can't drift.
- **Three writers, not two.** `updateOpportunityField` (case `status`) and
  `updateOpportunityPosition` were obvious. **`createOpportunity` is the third and easily
  missed**: it blocks only `requiresProject(status)`, and `requiresProject("closed_lost")` is
  `false`, so a deal can be *created* already lost.

`closed_won` → `closed_lost` keeps the **original** instant: that's a correction of an existing
decision, not a new one. Reopening clears it.

**The backfill is approximate and says so.** Rows closed before the column existed take
`updatedAt` — the last time the row was touched, which for a decided deal is *usually*, never
provably, the close. Not `created_at` (that files every historical win in the week its deal was
opened) and not NULL (the CHECK forbids it, and a NULL would make "won this month" silently
undercount rather than visibly approximate). **Consequence, accepted: for roughly a month after
this migration, a handful of long-closed deals whose rows happen to have been touched recently
appear in the closed-this-week/month figures.** Self-healing. Stated here so the first person to
notice files it as a known approximation rather than a bug.

### 2. Deal value is the linked project's plan revenue — and §4 is the price of that

`opportunities` has no amount column. Deal size therefore comes from the linked project's plan
via the existing pure `computeProjectMargin`: fixed fee → the project's `budgetAmount`
converted; time and materials → Σ(`billRate` × billable hours). This is not a new calculation —
it is byte-identical to what the deal's own plan drawer already shows, because
`getOpportunityPlan` defines "this deal's plan" as the linked project's *whole* plan.

Two rules make the aggregate honest:

- **A plan is priced or it isn't — never zero.** `computeProjectMargin` sums T&M revenue over
  counted roles, and an empty sum is a confident `0`. So a signed T&M project whose plan hasn't
  been built yet would report "no work sold" — a lie, not a zero. `countedRoleCount === 0` maps
  to `null` **for time and materials only**. A fixed fee is a contracted total that doesn't
  depend on staffing, so an unstaffed fixed-fee project still reports its fee — which is the
  common state of a deal at Negotiating, where the fee is agreed before the plan is built, and
  suppressing it would blank out the most useful figure in the bottom of the funnel. This is
  where the rule **parts company with `getProjectsList`'s `listMargin`**, whose blanket
  `countedRoleCount === 0 → null` is about *margin*: an unstaffed plan has a true-zero **cost**,
  so a fixed fee there would read as a triumphant 100% margin. Revenue has no such problem —
  don't "align" the two. Unpriced therefore means: no linked project, no billing model, or a T&M
  plan that is unbuilt or entirely cancelled.
- **Dedupe is per band.** Several opportunities can share one project (ADR 0024), so a project
  reached by two deals in the *same* band contributes once. A project reached from two
  *different* bands counts in each: there is deliberately no org-wide total for that to
  corrupt, and deciding which band "owns" a shared project is a judgement the data can't
  support.

### 3. No cost is read at all, so nothing new is gated

`getPlanRevenueByProject` calls `computeProjectMargin` with `includeCost: false` and an empty
`openRoleCostUsd`. `staff_employment` is never queried and `getProjectCostBasis` is never
called, so there is no compensation-derived figure for `projects.viewMargin` to protect. Revenue
is a commercial term about an engagement (ADR 0053 §7, ADR 0066 §9), and CRM reads already have
no per-capability gate, so the pipeline is open to every signed-in user with read parity to
`/opportunities`.

`permissions.ts`, `permissions.test.ts` and `docs/domains/permissions.md` are therefore
**deliberately untouched**, and both reads say so in their headers so an `/audit-rbac` pass
reads the omission as a decision. `getProjectsMarginContext` is specifically *not* reused for
its FX table, because it also computes a cost basis this has no use for.

### 4. The honesty problem worth naming: "deal value" has two definitions

Because deal size is the *linked project's whole* plan revenue, a project fed by an original
deal plus two extensions attributes **the full project value to each of the three** in Your
Status, while the company-wide band counts it **once**. The per-deal figure and the band total
genuinely use one word for two definitions.

This is not solved, it is **labelled**: "project plan value" per deal (never "deal value" or
"deal size"), "counted once per project" on the band, and a footnote saying several deals can
share one project. The proper fix — an explicit `opportunities.value` column, or an
apportionment rule — is a product decision the data cannot currently substitute for, and is out
of scope here. This is the one place where shipping the requirement as asked could put a number
on screen a salesperson would dispute.

### 5. Maturing is excluded, structurally

`maturing` is a holding pen, not a stage the funnel forecasts from: deals sit there indefinitely
without anyone working them, so counting them would inflate the top of the funnel with work
nobody is doing. `won`/`lost` are outcomes, counted separately and windowed.

All three are named in `NON_FUNNEL_GROUP_IDS` with their reasons, and a **module-load assertion**
requires every `OPPORTUNITY_GROUPS` id to be classified exactly once — into a band or as a stated
exclusion. Add a tenth pipeline group and the module throws at import until somebody places it.
So the bands **not** summing to the board's open-card total is a recorded decision, which is why
both blocks caption "Excludes Maturing".

Same exclusion in the personal block, deliberately: one definition of "funnel stage" per page,
and both reads share `FUNNEL_STATUSES` — which is also the reads' `WHERE status IN (…)` list, so
the SQL and the bands can't disagree.

### 6. "This week" is not inside "this month"

With a Monday-start week, `currentWeekStart()` can precede `currentMonthStart()` (today Wed 2
Sep → the week began Mon 31 Aug). The two closed figures are therefore **not nested**: a deal can
be in `week` and not in `month`. Three consequences:

- The SQL lower bound is `min(weekStart, monthStart)`, not `monthStart`.
- `summarizeClosed` tests the two windows **independently** and never treats one as a subset.
- The UI states both windows as **dates**, not as the bare words — "this week / this month"
  alone implies a nesting that doesn't hold.

The SQL bound is also deliberately **loose by one day**: `closedAt` is a zone-less `timestamp`
and the bound is a JS `Date` at local midnight, so a session-timezone skew could otherwise
*exclude* a row closed early on the boundary day. The JS fold re-buckets from each row's own ISO
day, so it is authoritative and the slack can only over-fetch by hours.

### 7. Pre-folded per filter value, not deal rows

The org block renders inside `LazerStatusSection`, a Client Component, so its prop is serialized
into the page HTML for every viewer (ADR 0063 §5). The panel renders **no per-deal row at all** —
only counts and band totals — so unlike `OrgPerson` there is nothing to itemize.
`getOrgPipeline` therefore ships one already-folded summary per line of business plus one for
"all". **No deal name, company name, owner name, opportunity id, project id or per-project
figure crosses the boundary**, and ADR 0063 §6's "a filtered count must be recomputed, never
reuse the server's unfiltered total" is satisfied *by construction*: every filter state has its
own server-side fold, from the same rows, by the same function. A `JSON.stringify` assertion in
`pipeline.test.ts` fails if that's ever "simplified" into shipping rows.

The personal block is the opposite shape — names, next steps, per-deal money — and is a **true
Server Component**, so none of it crosses at all. `MyDealView` is still a field-by-field
whitelist, because it is one directive away from being a boundary.

### 8. Two reads, one helper

Not one read, for three reasons: the two blocks live in bands ADR 0063 keeps as sibling async
Server Components *precisely so their reads overlap*; the payloads want opposite shapes (§7); and
the personal read must be own-data-only **by construction** — no id parameter, subject resolved
from the session — which a superset-then-filter read is not. Cost: `opportunities` is scanned
twice, noise at this table's size.

### 9. Revalidation: membership is fresh, value may lag

`revalidateOpportunity()` (`/opportunities` + `/`) is called by every writer that moves a
*membership* figure: status, create, delete, line of business, owners, the project link, and task
writes. `/` is dynamic, so this is about the client Router Cache — without it, navigating back
after moving a card serves a stale RSC payload.

The nine project-role writers **deliberately don't** call it. They move a plan's *value*, so
they'd shift a band aggregate by a rounding-scale amount that nobody is watching while editing a
plan on `/projects`, and threading it through nine call sites is a lot of omission risk for that.
Accepted staleness with a revisit trigger: if a pipeline value ever becomes a commitment number,
use a cache tag (ADR 0067's `updateTag` pattern) rather than sprinkling paths across the projects
domain.

### 10. Still no Suspense on `/`

Both reads run *inside* the two existing sibling Server Components, so they overlap with
`getAllocationsGrid` rather than extending the critical path; their cost is seven small indexed
queries. `loading.tsx` stays the only fallback. One honest new risk: `/` gains its **first
external HTTP dependency** in `getExchangeRates` — 12h-cached, never throws, falls back to
approximate rates and flags itself stale, but the first request per window pays a round trip. If
that fetch is ever made uncached, or the org read grows a whole-book role scan, the route's first
`Suspense` belongs around `OrganizationSection`, not around the card. FX is not optional: summing
a CAD fixed fee with a USD-rate T&M plan into one band total requires conversion.

## Consequences

- The bands don't sum to the board's open cards (§5). Captioned, and structural.
- Closed figures are approximate for about a month (§1). Self-healing.
- Per-deal and per-band value use different definitions of one word (§4). Labelled, not solved —
  the follow-up is an explicit deal-value column or an apportionment rule.
- Lazer Status is no longer purely point in time (§6). The alternative — dropping the closed
  counts — removes the only figure on the page that says whether the org is *winning*, so the
  amendment is the right trade; it just had to be written down.
- The line-of-business filter's meaning widened: it matches a person's *home* line of business on
  the staffing panels and a *deal's own* on the pipeline card. Coherent — the rule ADR 0063 §6
  states is about not matching a person's *work* when the person is the subject, and a deal has no
  person — but §6's text read as forbidding it, so it is amended rather than quietly reinterpreted.
  A card sitting under a band-scoping control while ignoring it would be worse: unchanged numbers
  above a filtered list is the classic filtered-dashboard bug.
- Two new test files, both pinning silent-wrong-number invariants no type expresses: the transition
  table's SQL↔JS agreement, and the band partition / per-band dedupe / unpriced classification /
  window straddle / payload whitelist.
- Seed changes in two places: `sales.ts` spreads `closedAt` so both windows have data (with the
  week-start straddle **forced**, since a random spread would usually miss it), and `projects.ts`
  now links open mid/bottom-funnel deals to projects — which also fixes a pre-existing seed
  illegality, since those stages require a project under ADR 0024, and points two deals at one
  project so the dedupe is visible in the running app.
