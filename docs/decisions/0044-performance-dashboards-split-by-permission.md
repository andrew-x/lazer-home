# 0044 — Split `/performance` into two dashboards; `/performance` becomes a permission-aware redirect

**Status:** accepted · 2026-07-28 · supersedes the "one page, one control bar, no
tabs" UI half of [ADR 0032](./0032-staff-rating-levels-effective-dated-manager-only.md)
(the data model, effective dating, and the `ratings` capability are unchanged)

> **Routes moved — read this ADR for the *reasoning*, not the paths.**
> [ADR 0055](./0055-nav-dashboards-vs-people-management.md) later regrouped these
> surfaces by read-vs-write and moved every route below: `/performance/compensation` →
> `/reporting/compensation`, `/performance/levels` → `/reporting/levels`,
> `/performance/levels/edit` → `/people/levels`, `/performance/compensation-plans` →
> `/people/compensation-plans`, and `/performance` → two redirects (`/reporting` and
> `/people`). A third dashboard, `/reporting/bonuses`, was split out of the
> Compensation page. The `/performance/*` paths below are kept as the historical
> record of *this* decision; the split, the gates, and the per-page control-bar
> reasoning are all unchanged and still current.

**TL;DR of the split:** `/performance/compensation` = **all money** (by role *and* by
level), gated `staff.viewCompensation`; `/performance/levels` = **level analytics
only, no money**, gated `ratings.view`; `/performance` = redirect.

## Context

[ADR 0032](./0032-staff-rating-levels-effective-dated-manager-only.md) put the
staff-**levels** analytics on the **same page** as the **compensation** analytics:
one route (`/performance`), one filter + currency control bar owned by
`PerformanceDashboard`, with the levels half rendered by a presentational
`LevelsSection` **only** when the server page passed the optional `ratingRecords`
prop (i.e. only for `ratings.view` holders). The reasoning was that the two views
are close cousins over the same active-staff / latest-employment base, so sharing
one control bar avoided duplicating controls and widening the sidebar.

In practice the merged page had three problems:

1. **It conflated two audiences with different gates.** Finance holds
   `staff.viewCompensation` but *not* `ratings.view`, so it saw a page whose
   content silently changed shape by role. The route's own gate was the *looser*
   of the two capabilities, and the stricter one was enforced only by the absence
   of a prop — correct, but the security-relevant boundary was invisible in the
   route structure.
2. **One page kept growing.** Comp KPI cards + by-role table + scatter, then
   level KPI cards + distribution chart + comp-by-level + avg-level-by-role +
   per-role subrating tables ([ADR 0042](./0042-per-role-subratings-app-owned-jsonb.md)).
   A single scroll with two `<h3>`-level sections under one `<h2>` stopped reading
   as one thing.
3. **The shared control bar spanned views with different needs.** One currency
   toggle governed both a money-dense comp view and a levels view whose only
   money-bearing element was the comp-by-level table — and nothing structurally
   tied that toggle to whether any money was on screen.

## Decision

**Two sibling dashboard routes, each with its own gate, its own read, and its own
control-bar instance; `/performance` stops being a page and becomes a
permission-aware redirect.**

- **`/performance/compensation`** — the **Compensation dashboard**: everything with
  money on it. Gated `staff.viewCompensation` (unchanged audience: finance /
  manager / admin). Reads `getCompensationSummaryData` + `getExchangeRates`,
  **plus `getRatingsSummaryData` conditionally** (below). Renders
  `CompensationDashboard` (`compensation-dashboard.tsx`): headcount / avg-comp /
  avg-hourly KPI cards, the by-role table, **compensation by level**, and the
  distribution scatter with its Compensation ↔ Hourly-rate metric toggle.
- **`/performance/levels`** — the **Performance dashboard**: level analytics, **no
  money at all**. Gated `ratings.view` (manager / admin, **not** finance). Reads
  `getRatingsSummaryData` **alone** — it needs no FX rates. Renders
  `PerformanceDashboard` (`performance-dashboard.tsx`, which absorbed the deleted
  `levels-section.tsx`): average-level + unrated KPI cards, the level-distribution
  bar chart, average-level-by-role, and the per-role subratings tables.
- **`/performance` — a redirect, not a page.** The sidebar's parent nav entry
  still points at `/performance`, so it forwards each viewer to the first
  dashboard they may see: `staff.viewCompensation` → `/performance/compensation`;
  else `ratings.view` → `/performance/levels`; else `notFound()`. Finance must
  never land on levels, so the order is not arbitrary.
- **`/performance/levels/edit`** is unchanged apart from its back-link, which now
  points at `/performance/levels`.

### Each dashboard owns its own filter bar — via a shared module, not shared state

`dashboard-filters.tsx` holds what the two dashboards must agree on without
sharing a React tree: `useDashboardFilters()` (line-of-business / employment-type
/ role + CAD-USD currency state), `DashboardFilterBar`, `matchesFilters`, and the
`FilterOptions` type (moved out of the old combined dashboard). Duplicating the
*state* per page is the point — the pages are independent — while duplicating the
*markup or the filter semantics* is what the module prevents.

**`DashboardFilterBar`'s `rates?: ExchangeRates` is optional, and the currency
toggle renders if and only if `rates` is passed** — so a dashboard structurally
cannot offer a currency choice without the rates that would honour it. (An earlier
cut used a separate `showCurrency` boolean; tying the affordance to its own data
removes the way to get that pair wrong.) The levels dashboard passes no `rates` and
therefore has no toggle; `useDashboardFilters` still holds `currency` state for
both, and the levels dashboard simply never reads it.

### The one cross-domain cut — compensation by level — lives on the comp page

**Compensation by level** (Level / Headcount / Avg comp / Comp range / Avg hourly /
Hourly range, between the by-role table and the scatter) is *money broken down by a
level*, so it sits on the dashboard whose own gate is the **comp** one, and it needs
**both** capabilities:

- The page gate is `staff.viewCompensation` — no bulk comp without it.
- The **levels input is fetched conditionally**:
  `const canViewLevels = userHasPermission(user, { ratings: ["view"] })`, then
  `canViewLevels ? getRatingsSummaryData() : undefined`, handed to
  `CompensationDashboard` as the optional **`ratingRecords`** prop. Undefined →
  that one table is not rendered. So **finance sees the Compensation dashboard
  minus the by-level table**; managers/admins see all of it.

This is the same conditional-fetch pattern the old merged page used, now applied to
one table instead of half a page — the stricter capability is enforced by *not
reading the data*, which is the strongest form available on a server page. Its
counterpart tightening: **`/performance/levels` surfaces no compensation
whatsoever**, so the `ratings.view` gate can't reach bulk comp at all.

Nuance for anyone reading the table: only **rated** staff **with** an employment row
contribute, so its "All levels" footer total can be lower than the headcount KPI
above it. Column labels read "Avg hourly" / "Hourly range" to match the by-role
table it now sits under.

### Nav: one section, three children

`nav.ts`'s Performance entry keeps `permission: { staff: ["viewCompensation"] }`
— deliberately the section's **loosest** gate, valid only because every
`ratings.view` role also holds `staff.viewCompensation`; otherwise the parent
would hide Levels from someone entitled to it. **If that matrix relationship ever
changes, this parent gate must change too.** Children: Compensation
(`/performance/compensation`, no extra gate), Levels (`/performance/levels`,
`ratings.view`), Edit levels (`/performance/levels/edit`, `ratings.edit`).

## Consequences

- **The route structure now encodes the permission boundary** at page granularity,
  instead of a prop's presence deciding half a page. A future analytics surface
  gets its own route + gate. The one surviving conditional prop (`ratingRecords`,
  for the by-level table) is deliberate and scoped to a **single table**, not a
  section.
- **Reads follow the page, not the viewer's role — except that one table.**
  `/performance/levels` fetches ratings only (no FX call at all).
  `/performance/compensation` fetches comp + FX always, and ratings **only** for
  `ratings.view` holders — so finance never touches the ratings read path.
- **Finance sees a single visible child**, so `NavMenuItem` degrades to a plain
  link to `/performance`, which redirects to `/performance/compensation`. That
  degradation path (≤1 visible child → plain link) is pre-existing behaviour; see
  [ui.md](../ui.md) → *App shell & sidebar* → Submenus.
- **Filter/currency state no longer carries across the two views** — switching
  dashboards resets to "All" / CAD. Accepted: they're separate pages with separate
  audiences, and there is no URL state to sync (filters are in-memory, as before).
- **`revalidatePath` targets moved.** `saveStaffEvaluation` revalidates
  `/performance/levels` (+ the edit page), not `/performance`. Any new levels
  surface must be added there.
- **No schema, permission-matrix, or read-action changes.** Both reads
  (`getCompensationSummaryData`, `getRatingsSummaryData`) still `requirePermission`
  server-side and still return anonymized rows — the ADR 0032 discipline that no
  identity leaves the server is untouched.

## Alternatives considered

- **Keep one page and add a tab bar.** Rejected again, for the reason ADR 0032
  rejected it the first time: tabs across two differently-gated views mean either
  a tab that 404s or a tab bar whose shape depends on the viewer. Sibling routes
  with independent gates say the same thing more honestly, and the sidebar submenu
  already provides the switch.
- **Keep the merged page, just split the headings.** Rejected: one page would keep
  serving two audiences, with the stricter capability expressed only as "half the
  page wasn't passed its prop."
- **Put compensation-by-level on the levels dashboard** (its first landing spot in
  this change, gated by a `canViewCompensation` prop on that page). Rejected on
  reflection: it made the *levels* route a bulk-comp surface reached through
  `ratings.view`, needing a comp check bolted on to stay honest. Money-shaped tables
  belong on the money page; the levels page is now comp-free, which is simpler to
  reason about and strictly tighter.
- **Make `/performance/levels` the section index and drop the redirect.**
  Rejected: finance can't see levels, so the parent nav href would 404 for them.
  A redirect keeps one stable section entry point for every audience.
- **Lift filter state into a URL query string or shared provider so it survives
  the hop between dashboards.** Rejected as unnecessary coupling for two pages
  users don't rapidly toggle; the in-memory filters of ADR 0032 stayed as-is.
