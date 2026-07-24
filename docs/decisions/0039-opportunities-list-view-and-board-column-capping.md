# 0039 — Opportunities list view + board column capping

**Status:** accepted · 2026-07-24

## Context

The opportunities kanban ([ADR 0021](./0021-opportunity-pipeline-groups-and-fractional-ordering.md))
fetched *every* card and rendered them all. That's fine for a live pipeline, but
three columns grow without bound: **Maturing** accrues early-stage deals, and the
two **closed** columns (Won / Lost) accrue every decided deal forever. Over time
those columns dominate the payload and the DOM, and the board's client-side name
search only filters cards already loaded — so a closed deal from last year is
effectively unfindable. The board is a *pipeline management* surface, not a
records browser; it shouldn't have to be both.

## Decision

**Cap the high-volume board columns and add a separate, server-filtered list view
as the exhaustive browse.** No schema change (reuses existing `status`,
`lineOfBusiness`, `updatedAt`).

- **Board column capping.** `CAPPED_BOARD_STATUSES` = `maturing`, `closed_won`,
  `closed_lost` (in `src/lib/crm/opportunity-pipeline.ts`) return only their
  `BOARD_COLUMN_CAP` = 20 most-recently-updated cards; every other column returns
  in full. `getOpportunitiesBoard` now returns `{ cards, cappedTotals }` (was a
  bare array) — `cappedTotals` is the *full* per-status count for each capped
  column, so the board knows when to offer a **"Show N more"** link
  (`opportunity-board-column.tsx`) that deep-links to `?view=list&stage=<group>`
  (carrying `&lob=<LOB>` when the board's line-of-business filter is active, so
  the list applies both filters). Capping is done with `row_number()` / `count()`
  window functions partitioned by
  `status` in a subquery (windows can't be filtered inline), then a `WHERE` that
  keeps all uncapped-status rows plus `rn ≤ 20` of each capped one.
- **List view** (`?view=list`). `getOpportunitiesPage` — the app's **first
  filtered/searchable paginated read** — returns `Page<OpportunityRow>` ordered
  `updatedAt desc`, with server-side **stage** (a kanban `OpportunityGroupId`,
  expanded to leaf statuses via the new `opportunityGroupById`), **line of
  business**, and **name/company search** filters. It reuses `getCompaniesPage`'s
  pagination plumbing (`clampPage`, `Page<T>`) and shares the grouped owner-name
  query with the board via the extracted `resolveOwnerNames`
  (`opportunityOwnerNames.ts`).
- **URL-driven view toggle, link-based not local state**
  (`opportunity-view-toggle.tsx`). The chosen view + filters live entirely in the
  URL (`view`, `stage`, `lob`, `q`, `oppPage`), which is what lets the board's
  "Show more" links deep-link straight into a pre-filtered list. Filters navigate
  via `router.replace`, reading their current values from the params the page
  already parsed (no `useSearchParams`, so no Suspense boundary).
- **No standalone detail route.** The list's name cell opens the *same*
  `OpportunityDetailSheet` drawer the board uses (edit-gated — plain text for
  non-`crm.edit` viewers). The drawer stays the single detail affordance.
- **RBAC unchanged.** `getOpportunitiesPage` is ungated beyond the `(app)` layout,
  matching every other CRM read.

## Consequences

- The board payload/DOM is bounded regardless of how many deals close; the list
  is the authoritative place to find capped/closed deals and to search the whole
  pipeline.
- **Board filters remain loaded-only by design** — the board's client-side name
  search *and* line-of-business select filter just the cards already on the board,
  so neither can surface cards beyond a column's cap. That's an accepted
  limitation; the list view's server-side filters are the exhaustive ones (and an
  active board LOB filter rides through the "Show more" deep-link into the list).
- One more read to keep in step with the schema, but it shares pagination and the
  owner-name query with existing reads, so the net new surface is small.

## Alternatives considered

- **Paginate / infinite-scroll the board columns themselves.** Rejected — it
  muddies the board's job (drag-ordering a live pipeline) with records-browsing,
  and per-column paging inside a horizontally-scrolling kanban is awkward. A flat
  table is the right shape for filtered browsing.
- **Local component state for the view toggle.** Rejected — the "Show more"
  deep-link needs the view + stage filter to be expressible as a URL, so the URL
  is the source of truth.
- **A standalone `/opportunities/[id]` detail page.** Rejected for now — the
  drawer already covers detail/edit in both views; a second detail surface would
  duplicate it.
