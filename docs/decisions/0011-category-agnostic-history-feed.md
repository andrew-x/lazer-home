# 0011 — The profile history feed is a category-agnostic, server-merged timeline

**Status:** accepted · 2026-06-17

## Context

The `/profile` page needs to show a person their own change history. The first source is **employment**: `staff_employment` is effective-dated history-as-rows ([ADR 0007](./0007-staff-employment-effective-dating.md)), so a person's role / line-of-business / type / billability changes are already a chronological series of rows.

The obvious first cut — and the one that initially existed — was an **employment-specific** drawer (`getMyEmploymentHistory.ts` + `employment-history-sheet.tsx`) that read employment rows and rendered them directly. But this is a connected PSA system: the same "what changed about me, when" timeline will soon need to fold in **compensation** changes (a future effective-dated rate/cost table) and **project allocations** (a future domain). An employment-shaped read and an employment-shaped component would each have to be reworked — or duplicated per source with N drawers — when those land.

## Decision

Replace the employment-specific feed with a **category-agnostic** one, designed up front to merge multiple sources into a single sorted timeline.

- **One normalized entry shape.** `getStaffHistory(staffId, includeCompensation?)` (`src/actions/staff/getStaffHistory.ts`, a server-only actions-layer read per [ADR 0010](./0010-actions-layer-owns-db-access.md)) returns `HistoryEntry[]` = `{ id, date, category, summary }`, where `HistoryCategory = "EMPLOYMENT" | "ALLOCATION"`. Each source is responsible for projecting its own rows into this shape (e.g. employment builds a `summary` like `"Engineer · Core · Full time · Billable"`). **Compensation is not a separate category** — per [ADR 0020](./0020-compensation-effective-dated-import-only.md) comp lives on the effective-dated employment row itself, so it folds into that entry's summary, gated by the `includeCompensation` flag (the result of `canViewCompensation`) so comp amounts never ship to a client that can't view them.
- **Fetch-map-push, then one merge.** Each source queries by the passed `staffId` and pushes entries into a shared array; a single `Array.sort` at the end produces the newest-first feed. The reads are **not self-ownership-scoped**: the #33 profile redesign generalized the profile reads (`getStaffProfile` / `getStaffHistory` / `getStaffProjects` / `getStaffPto`) to take **any** `staffId`, authorized at the **page/profile level** rather than inside each read — `/profile` resolves the viewer's own id via `getCurrentStaffId` and passes it in. Because `date` is a `"YYYY-MM-DD"` wall-clock string, lexicographic compare is chronological, and `Array.sort` is stable, so equal-date entries keep their per-source insertion order (employment relies on this to preserve the ADR 0007 `effectiveFromDate desc, createdAt desc` ordering within a date).
- **The UI is purely presentational.** `HistoryTimeline` (`src/components/staff/history-timeline.tsx` — originally the `HistorySheet` drawer, later extracted into this inline timeline when the profile moved to tabs) takes the `HistoryEntry[]` and renders each as a category `Badge` + date + summary. It has no per-category branching beyond a label map, so a new category needs no UI change.
- **Today only employment is wired** (with compensation folded into its summary). Allocation is a documented stub in the `HistoryCategory` union and in code comments — adding it is "add a fetch + map block" in `getStaffHistory`, nothing else.

## Consequences

- **Adding a history source is local and additive:** a new query + projection in `getStaffHistory`, plus extending the `HistoryCategory` union and the label map. No change to the page or the timeline.
- **Authorization moved from the read to the page.** With reads taking any `staffId`, the security burden shifted to whoever renders the profile (page/profile-level gating), rather than each read structurally scoping to `staff.userId = user.id`. This is **accepted for now and under reevaluation** — if profile viewing grows finer-grained rules, the gate may need to move back down into the reads (or into a shared authorize helper). Any new caller passing a `staffId` it didn't derive from the current user must authorize it first.
- **The feed is read-only and derived** — there is no `history` table. The timeline is recomputed from the source-of-truth tables on each read, so it can never drift from them. (If a source is *not* effective-dated history-as-rows, it must still be able to emit dated entries to participate.)
- **`summary` is rendered as-is**, so each source owns its own human-readable phrasing (via `humanizeEnum`/`formatDate` in `src/lib/format.ts`). Cross-source phrasing consistency is a convention, not enforced by a type.
- The removed `getMyEmploymentHistory.ts` / `employment-history-sheet.tsx` are gone; don't reintroduce per-domain history components.

## Alternatives considered

- **Keep the employment-specific drawer, add sibling drawers per domain** — rejected: N drawers, N reads, and no single chronological view; a user wants one timeline, not three tabs.
- **A persisted `history` / audit table written on every change** — rejected for now: it's a second source of truth to keep in sync, and the underlying tables (effective-dated employment, future comp) already *are* the history. Derive on read instead. Revisit only if a change needs attributes the source rows don't carry (e.g. actor, reason) or if merge-on-read becomes a performance problem.
- **A generic per-source registry/interface abstraction** — rejected as premature: with one live source and one known future one (allocation), an explicit fetch-map-push block per source is clearer than an indirection layer. Promote to an abstraction only if the count or shape grows unwieldy.
