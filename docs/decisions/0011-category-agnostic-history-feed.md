# 0011 — The profile history feed is a category-agnostic, server-merged timeline

**Status:** accepted · 2026-06-17

## Context

The `/profile` page needs to show a person their own change history. The first source is **employment**: `staff_employment` is effective-dated history-as-rows ([ADR 0007](./0007-staff-employment-effective-dating.md)), so a person's role / line-of-business / type / billability changes are already a chronological series of rows.

The obvious first cut — and the one that initially existed — was an **employment-specific** drawer (`getMyEmploymentHistory.ts` + `employment-history-sheet.tsx`) that read employment rows and rendered them directly. But this is a connected PSA system: the same "what changed about me, when" timeline will soon need to fold in **compensation** changes (a future effective-dated rate/cost table) and **project allocations** (a future domain). An employment-shaped read and an employment-shaped component would each have to be reworked — or duplicated per source with N drawers — when those land.

## Decision

Replace the employment-specific feed with a **category-agnostic** one, designed up front to merge multiple sources into a single sorted timeline.

- **One normalized entry shape.** `getMyHistory()` (`src/actions/staff/getMyHistory.ts`, a server-only actions-layer read per [ADR 0010](./0010-actions-layer-owns-db-access.md)) returns `HistoryEntry[]` = `{ id, date, category, summary }`, where `HistoryCategory = "EMPLOYMENT" | "COMPENSATION" | "ALLOCATION"`. Each source is responsible for projecting its own rows into this shape (e.g. employment builds a `summary` like `"Engineer · Core · Full time · Billable"`).
- **Fetch-map-push, then one merge.** Each source does its own ownership-scoped query (`staff.userId = user.id`) and pushes entries into a shared array; a single `Array.sort` at the end produces the newest-first feed. Because `date` is a `"YYYY-MM-DD"` wall-clock string, lexicographic compare is chronological, and `Array.sort` is stable, so equal-date entries keep their per-source insertion order (employment relies on this to preserve the ADR 0007 `effectiveFromDate desc, createdAt desc` ordering within a date).
- **The UI is purely presentational.** `HistorySheet` (`src/components/staff/history-sheet.tsx`) takes the `HistoryEntry[]` and renders each as a category `Badge` + date + summary. It has no per-category branching beyond a label map, so a new category needs no UI change.
- **Today only employment is wired.** Compensation and allocation are documented stubs in the union and in code comments — adding one is "add a fetch + map block" in `getMyHistory`, nothing else.

## Consequences

- **Adding a history source is local and additive:** a new query + projection in `getMyHistory`, plus extending the `HistoryCategory` union and the label map. No change to the page or the drawer.
- **The feed is read-only and derived** — there is no `history` table. The timeline is recomputed from the source-of-truth tables on each read, so it can never drift from them. (If a source is *not* effective-dated history-as-rows, it must still be able to emit dated entries to participate.)
- **`summary` is rendered as-is**, so each source owns its own human-readable phrasing (via `humanizeEnum`/`formatDate` in `src/lib/format.ts`). Cross-source phrasing consistency is a convention, not enforced by a type.
- The removed `getMyEmploymentHistory.ts` / `employment-history-sheet.tsx` are gone; don't reintroduce per-domain history components.

## Alternatives considered

- **Keep the employment-specific drawer, add sibling drawers per domain** — rejected: N drawers, N reads, and no single chronological view; a user wants one timeline, not three tabs.
- **A persisted `history` / audit table written on every change** — rejected for now: it's a second source of truth to keep in sync, and the underlying tables (effective-dated employment, future comp) already *are* the history. Derive on read instead. Revisit only if a change needs attributes the source rows don't carry (e.g. actor, reason) or if merge-on-read becomes a performance problem.
- **A generic per-source registry/interface abstraction** — rejected as premature: with one live source and two known future ones, an explicit fetch-map-push block per source is clearer than an indirection layer. Promote to an abstraction only if the count or shape grows unwieldy.
