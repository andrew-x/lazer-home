# 0017 — Skills stored inline (jsonb) from a hardcoded catalogue, not a normalized table

**Status:** accepted · 2026-07-08

## Context

Staff profiles needed **skills with a proficiency level**. The data model had long
*proposed* this as a normalized many:many `Skill` entity — a `skill` table plus a
join table carrying proficiency, possibly effective-dated like `staff_employment`
(see the old open questions in [data-model.md](../data-model.md) and
[domains/staff-profiles.md](../domains/staff-profiles.md)).

That design buys efficient cross-entity queries ("who knows React?"), a curated
taxonomy editable without a deploy, and per-skill history. But nothing in the app
needs any of that yet: there's no allocations skill-matching, no skills reporting,
and the catalogue is small and curated by us. The proposed design is real schema
weight (two tables, join writes, N+1-avoidance on reads) bought against a
speculative need.

## Decision

Store skills **inline on the `staff` row** as a single `jsonb` column
`skills` (`StaffSkill[]` = `{ name, level }[]`, **NOT NULL default `[]`**) —
the schema's **first jsonb/array column** (`drizzle/0015_big_venus.sql`).

- **Catalogue lives in code**, not the DB: `src/lib/skills.ts` is the single source
  of truth for the pickable skills (`SKILL_CATEGORIES`, grouped by discipline —
  currently PLACEHOLDER values), the flat `ALL_SKILLS` / `SKILL_TO_CATEGORY` helpers,
  the fixed 3-value proficiency set (`PROFICIENCY_LEVELS` =
  `senior`/`intermediate`/`learning`, ordered most→least, with `PROFICIENCY_LABELS`),
  and the `StaffSkill` type.
- The module is **client-safe** (no `server-only` import) because it's imported by
  three places at once — the client picker UI, the server `updateStaffSkills.schema.ts`
  validation, and the Drizzle schema's `$type<StaffSkill[]>()`. Same pattern as
  `staff-import/types.ts` and the shared CRM enum module ([ADR 0016](./0016-junction-table-and-shared-enum-conventions.md)).
- **Edited via a dedicated page** `/staff/[id]/skills` (not a dialog like the other
  profile cards — the three-bucket editor is too large for one), gated by the reused
  `authorizeStaffEdit` / `canEditStaff` hook: own profile always, others need
  `staff.edit`. **No new permission was added; the RBAC matrix is unchanged.** The
  mutation `updateStaffSkills` replaces the whole list and validates every name is in
  the catalogue and that no skill is duplicated.

## Consequences

- **No cross-staff skill queries.** "Who knows React at senior level?" means scanning
  every `staff.skills` jsonb rather than an indexed join. Fine at company scale; when
  allocations skill-matching or skills reporting arrives, revisit — either add a GIN
  index on the jsonb or migrate to the normalized `skill` + join tables this ADR
  deferred. The catalogue-in-code shape makes such a migration mechanical.
- **Taxonomy changes require a code deploy** (edit `src/lib/skills.ts`), not a DB
  write or admin UI. Acceptable while the list is small and curator == developer; the
  PLACEHOLDER set is expected to be swapped for a curated one the same way.
- **Proficiency is a fixed 3-value set** baked into code, not a per-org configurable
  scale. Changing it is a code + (if display order matters) UI change.
- **No per-skill history / effective dating** — unlike `staff_employment`, the skills
  list is edited in place. A change overwrites; we don't record when someone reached a
  level. If skill progression over time becomes a performance-management input, that's
  the gap.
- Unknown skill names are rejected server-side, so the column can only ever hold
  catalogue members — the jsonb stays clean without a DB-level constraint.

## Alternatives considered

- **Normalized `skill` + `staff_skill` join (the original proposal), effective-dated** —
  rejected *for now* as premature: real schema and read-path weight for queries and
  history nothing yet consumes. Explicitly the fallback if cross-entity skill use
  appears.
- **A `skill` catalogue table (DB-driven), skills still inline** — rejected: adds a
  table and a read just to move the placeholder list out of code, with no query benefit
  while usage is inline-only. A code array is simpler and type-safe end to end.
- **Free-text skills (no catalogue)** — rejected: no consistency, would make any future
  matching/reporting hopeless. A closed catalogue keeps the door open cheaply.
