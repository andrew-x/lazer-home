# 0042 — Per-role rating subratings: app-owned jsonb on `staff_rating`, co-dated with the overall level

**Status:** accepted · 2026-07-27

## Context

The overall performance **level** (L0–L4) from
[ADR 0032](./0032-staff-rating-levels-effective-dated-manager-only.md) is a single
blunt number. Managers wanted to record the **reasoning behind** a level as
per-category scores — communications, technical depth, output craft, etc. — each
on an **L1–L4** scale (or left unset). The catch: **the set of categories differs
per role.** An engineer's rubric is not a designer's; some roles have no rubric at
all yet. And the categories will be tuned over time as the consultancy figures out
what it actually assesses.

Three constraints shaped the storage choice:

1. **The rubric is role-specific and volatile.** We expect to add roles, add/rename
   categories, and reword labels frequently — none of which should require a DDL
   migration or a schema deploy gated on the DB.
2. **The subrating history must be preserved** exactly like the level — a manager
   should be able to see how the category scores moved over time, co-dated with the
   level they were captured alongside.
3. **The overall level stays independent.** Subratings are *extra detail*, not a
   derivation of the level (a manager can set an L3 overall with mixed L2/L4
   category scores). We must not couple the two.

Two prior decisions frame the shape:

- [ADR 0007](./0007-staff-employment-effective-dating.md) — the effective-dated
  fact-row pattern (`staff_rating` already follows it).
- [ADR 0028](./0028-generic-responses-table-app-validated-question-ids.md) — the
  established "**flexible jsonb payload, shape owned by app code and validated at
  the zod layer, not the DB**" pattern (the survey `responses` table, whose
  `questionId` is plain text validated in app code so a new survey needs no
  migration). The inline `skills` jsonb ([ADR 0018](./0018-skills-inline-jsonb-catalogue.md))
  is the same instinct.

## Decision

**Add a nullable `subratings jsonb` column to the existing `staff_rating` row,
typed `Record<categoryKey, level>`, with the rubric owned entirely by a pure app
module — no normalized subrating table, no DB enum for the categories.**

### Storage — one jsonb column, co-dated with the level

`staffRating.subratings` (`src/lib/db/performance-schema.ts`) is
`jsonb().$type<Subratings>()`, nullable (`null`/absent = no subratings recorded).
It rides on the **same append-only dated row** as `level` (migration
`drizzle/0007_high_mister_sinister.sql`), so saving an evaluation captures level +
subratings together and the subrating history is dated exactly like the level —
ADR 0007's pattern extends for free, no new granularity. The overall `level`
remains a plain independent integer; subratings are **not** derived from it.

### The rubric is app-owned, code-only — no DB enum, no migration to change

`src/lib/performance/rating-rubric.ts` is the single source of truth: a pure,
client-importable module (no drizzle) exporting `SUBRATING_MIN`/`MAX` (1–4),
`SUBRATING_LEVELS`, `type Subratings = Record<string, number>`, `ROLE_RUBRICS`
(`Partial<Record<Role, RubricCategory[]>>` — only `ENGINEER` populated so far, 8
categories), `rubricForRole(role)`, and the flattened `ALL_RUBRIC_CATEGORIES` /
`ALL_RUBRIC_KEYS` / `RUBRIC_LABELS` the edit grid consumes. It reuses the
`L`-prefix display + string codec from `@/lib/staff/staff-rating`. Adding a role's
rubric, adding a category, or rewording a label is a **code-only** change — no
migration. The **category keys are stable identifiers stored in the jsonb**, so a
key rename *would* need a data migration (the module comment says so); labels are
free to change.

### Validation lives at the zod/action layer, not the DB

The DB stores whatever jsonb it's given — the shape is enforced above it, mirroring
`responses`. The zod schema (`saveStaffEvaluation.schema.ts`) validates loosely
(`record(string, int 1–4)`, since the valid keys are role-dependent), and the
action (`saveStaffEvaluation.ts`) **hardens it against the person's actual
current-role rubric**: `sanitizeSubratings` re-reads each target's latest role and
drops any key not in that role's rubric (so a crafted payload can't smuggle keys),
collapsing to `null` when nothing survives. No-op detection now requires **both**
the level unchanged **and** the subratings value-equal (`canonicalSubratings` =
sorted-key JSON, so key order is irrelevant) before a row is skipped.

## Consequences

- **Adding/tuning a rubric is a code deploy, never a migration** — the whole point.
  Only widening the subrating *scale* (1–4) or renaming a stored *key* would touch
  data.
- **Subrating history is free**, co-dated with the level on the same row — the
  seed models this by giving only the *current* rating row subratings (historical
  rows predate the feature), which is exactly how real data will accrue.
- **No referential integrity on category keys** — the DB can't reject a stale key,
  so the sanitize step in the action is load-bearing (not decorative). A key that
  drops out of a role's rubric silently stops being written and stops rendering;
  old rows keep their now-orphaned keys until overwritten.
- **The overall level and subratings can disagree**, by design. Any future
  aggregate that wants "average of subratings" must compute it explicitly; it is
  not the level.
- **The read-only `/performance` dashboard aggregates over subratings too** — a
  purely additive per-role average-subrating-by-category breakdown
  (`computeAverageSubratingsByRole`), fully anonymized like the rest of the
  dashboard. This is read/aggregation only; the storage decision above is unchanged.
- **No permission change.** Subratings are part of the same `staff_rating` row and
  inherit the `ratings.view`/`ratings.edit` (manager/admin-only, no self-view) gate
  from ADR 0032 verbatim.

## Alternatives considered

- **A normalized `staff_rating_subrating` table** (one row per category per
  evaluation, FK to the rating row, category as a column). Rejected: it buys
  referential shape we don't want to pay migrations for — every rubric tweak
  becomes DDL or a lookup-table write, and the per-role variability makes a clean
  FK-to-category-enum awkward. The jsonb keeps the whole evaluation (level +
  categories) in one row, co-dated, matching the `responses`/`skills` precedent.
- **A DB `pgEnum` (or lookup table) for the category keys.** Rejected for the same
  reason `responses.questionId` is plain text ([ADR 0028](./0028-generic-responses-table-app-validated-question-ids.md)):
  the rubric changes often and per-role, so pinning the keys in the DB turns every
  change into a migration for no integrity we actually rely on.
- **Deriving subratings from / rolling them into the overall level.** Rejected: the
  level is a deliberate independent judgment, and coupling them would forbid the
  common case of an overall score that doesn't mechanically average the categories.
- **A separate effective-dated subratings table (its own dated rows).** Rejected:
  it would let level history and subrating history drift out of step; co-dating on
  the one `staff_rating` row is simpler and matches how an evaluation is actually
  captured (one sitting, one row).
