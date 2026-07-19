# 0032 — Staff rating levels (L0–L4): effective-dated, nullable, manager/admin-only with no self-view

**Status:** accepted · 2026-07-18

## Context

The performance domain needed an **overall performance level** per person — a
single L0–L4 rating a manager assigns, distinct from peer feedback (which is
per-interaction, [ADR 0023](./0023-feedback-privacy-tiers.md)) and from
compensation. Requirements: managers assign and adjust levels over time, the
history of a person's level matters (you want to see the trajectory), some people
are simply **not yet rated**, and the aggregate distribution feeds a dashboard
(how many at each level, comp/rate per level, average level by role).

Three prior decisions frame the shape:

- [ADR 0007](./0007-staff-employment-effective-dating.md) — durable identity +
  **effective-dated fact rows** (latest `effectiveDate` = current). The established
  pattern for "a fact about a person that changes over time and whose history we keep."
- [ADR 0016](./0016-junction-table-and-shared-enum-conventions.md) — the
  **shared-enum** convention: values live in a pure, client-importable module that
  the schema, the zod validation, and the UI all import (as `feedback-rating.ts` /
  `line-of-business.ts` do).
- [ADR 0014](./0014-rbac-better-auth-access-control.md) — capabilities in
  `permissions.ts`, gated via action metadata / server-only read guards; the
  matrix is the contract.

## Decision

**A new effective-dated `staff_rating` table, following `staff_employment`
exactly, with the level a nullable integer, gated by a new manager/admin-only
`ratings` capability that has no owner-visible path, surfaced as a section merged
into the single `/performance` dashboard (sharing one filter bar — no tabs).**

### Effective-dated, like employment

`staff_rating` (`src/lib/db/performance-schema.ts`): `staffId` (FK → staff,
cascade), `effectiveDate` (`date`, string mode), `level` (integer, **nullable**),
`evaluatedByUserId` (FK → user, **set null** — a rating outlives the evaluator's
record), timestamps. Saving an evaluation **inserts a new dated row per
genuinely-changed staff member**; the current level is the latest row per staff.
The ordering fragment is `latestRatingFirst` (`src/lib/staff-rating-history.ts`,
`desc(effectiveDate)` then `desc(createdAt)` to break same-day ties) — a direct
mirror of `latestEmploymentFirst`. The pure shared module is
`src/lib/staff-rating.ts` (`RATING_LEVELS`, `MIN/MAX_RATING_LEVEL`, `formatLevel`
→ `"L0".."L4"`/`"Unrated"`, `formatAverageLevel` → `"L2.3"`, `isRatingLevel`),
mirroring `feedback-rating.ts`.

### Level is a nullable integer 0–4; null = unrated as a real, historied event

`level` is a plain `integer`, not a pgEnum, bounded by a DB `CHECK`
(`staff_rating_level_range`: `level is null or level between 0 and 4`, bounds
embedded as raw SQL literals from `MIN/MAX_RATING_LEVEL`). **Null means
explicitly unrated** — and because it's a row, a manager can *set someone back to
unrated* as a dated event, distinct from a person who simply has **no rows yet**
(also unrated). Both collapse to "Unrated" in every read (`level ?? null`), so
consumers never distinguish them, but the historied null lets an evaluation
legitimately clear a rating. A numeric level (not an enum) is what makes averaging
meaningful — the dashboard computes mean levels (`L2.3`) and per-role averages.

### Manager/admin-only, with NO owner-visible path — stricter than compensation

A new resource **`ratings: ["view", "edit"]`**, granted to **manager + admin
only**. Deliberately **not** finance — unlike `staff.viewCompensation`, which
finance holds. And there is **no self-view**: a staffer never sees their own
level, nor anyone else's. This is *stricter* than both compensation (own comp
always visible, [ADR 0020](./0020-compensation-effective-dated-import-only.md))
and feedback (recipients see a limited projection, givers see their own,
[ADR 0023](./0023-feedback-privacy-tiers.md)). A raw level is a blunt, sensitive
judgment with no useful owner-facing framing, so it stays entirely inside the
manager/admin tier. Both reads (`getRatingsSummaryData`, `getStaffRatingsForEdit`)
`requirePermission({ ratings: ["view"] })`; the write (`saveStaffEvaluation`)
gates `metadata.permission: { ratings: ["edit"] }`; the pages `notFound()`, and the
`/performance` server page fetches the levels data (`getRatingsSummaryData`) **only**
for `ratings.view` holders — so the levels section is omitted entirely for everyone
else. Defense in depth. Matrix, `permissions.test.ts`, and
`docs/domains/permissions.md` updated in lockstep.

### Surfaced as a section on the single `/performance` dashboard — no tabs

The levels analytics render **inline on the existing `/performance` page**, below
the compensation section, via `levels-section.tsx` (`LevelsSection`) — **not** a
separate route, **not** a tab bar, **not** a new sidebar entry. The two views are
close cousins (both workforce analytics over the same active-staff /
latest-employment base, same currency toggle + FX), so rather than duplicate a
filter/currency bar per view they share **one** control bar: `PerformanceDashboard`
owns the filter + currency state and passes the chosen values to `LevelsSection` as
props. The server page fetches the levels data only for `ratings.view` holders and
passes it as the optional `ratingRecords` prop; `LevelsSection` renders **only when
that prop is present**, so finance sees compensation only. The edit table stays at
`/performance/levels/edit` (`ratings.edit`), linked from the section's "Edit levels"
button; its "back" link points to `/performance`. (An earlier iteration used a
cross-route `performance-tabs.tsx` bar and a standalone `/performance/levels`
dashboard route; both were removed in favor of the merged single-page layout.)

### Reuses the compensation dashboard's machinery

The Levels section reads anonymized per-active-staff rows (`RatingRecord` =
`CompensationRecord` + `level`, no identity leaves the server), and the
comp/rate-per-level table **reuses `computeByRole`** from `performance-stats.ts`,
tagging the group key with the level label. Level-specific math (distribution,
unrated count, average level, average-by-role) is the new pure
`src/lib/rating-stats.ts`. The distribution is a hand-rolled SVG **bar chart**
(zero baseline — see `docs/ui.md`). Currency toggle + FX are identical to the comp
dashboard ([ADR 0029](./0029-external-fx-rates-and-currency-normalization.md)).

## Consequences

- **Level history is free** — a level change is just another dated row, same as a
  role change. No separate history granularity; `latestRatingFirst` + `firstPerKey`
  yields the current level, exactly as employment does.
- **The write is defensive.** `saveStaffEvaluation` re-reads the current level per
  staff, **drops no-op rows**, rejects unknown/inactive targets, and **rejects an
  effective date that predates a staff member's latest rating** (which would insert
  a non-current historical row); equal dates are fine (the `createdAt` tiebreak
  makes the newer write current). Template was `commitBulkEditEmployment`.
- **A new rating surface must pass `ratings.view`** and expose no identity — the
  anonymized-rows discipline of the comp dashboard carries over. Never add a
  self-view path without revisiting this ADR.
- **Adding a level would touch DDL.** Because the bound is a DB `CHECK` (not an
  enum), widening L0–L4 means a migration altering the constraint plus the
  `MAX_RATING_LEVEL` constant — deliberate friction for a rarely-changing scale.

## Alternatives considered

- **A `feedback_rating`-style pgEnum for the level.** Rejected: levels are
  inherently ordinal *numbers* we average and chart; storing them as an integer
  keeps the math direct (mean, distribution) and lets the shared module expose them
  as `number`s. The `L` prefix is purely a display concern (`formatLevel`).
- **Mutable single row per staff (overwrite on change).** Rejected — it throws away
  the trajectory, the whole point of a level over time. Effective-dating (ADR 0007)
  already solves this and is the house pattern.
- **An owner-visible tier (a staffer sees their own level), like comp/feedback.**
  Rejected for the first slice: a bare L-number has no constructive owner framing.
  Kept entirely manager/admin. Reconsider only alongside a review/growth surface
  that gives the number context.
- **Granting `ratings.view` to finance** (reusing the comp audience). Rejected:
  levels are a management judgment, not a financial fact; finance's interest is
  compensation, which they already see. Ratings are a narrower audience.
- **A separate top-level nav item (or its own route/tab) for ratings.** Rejected:
  it's a second lens on the same workforce-analytics base as compensation, so it
  lives as a section on the one `/performance` dashboard sharing its filter bar —
  keeping the two adjacent without widening the sidebar or duplicating controls. (A
  cross-route tab bar was tried first, then collapsed into this single page.)
