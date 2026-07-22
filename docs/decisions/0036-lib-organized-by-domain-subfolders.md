# 0036 — `src/lib` organized by domain subfolders

**Status:** accepted · 2026-07-21

## Context

`src/lib/` had grown to ~50 flat modules — enum tuples, pure derived-field
helpers, zod primitives, formatters, the action client, auth/permissions, the
CSV importers — all siblings in one directory. The rest of the codebase is
already grouped by domain: the actions layer lives under `src/actions/<domain>/`
and the schema is split into per-domain modules under `src/lib/db/*-schema.ts`
([ADR 0035](./0035-schema-modules-by-import-boundary.md)). `src/lib/` was the
odd one out — a flat pile that was hard to scan and gave no home for "where does
a new helper go?"

## Decision

**Group `src/lib/` into domain (and cross-cutting) subfolders.** Every file kept
its name and its exports — **only the import prefix changed**
(`@/lib/<file>` → `@/lib/<group>/<file>`). No behavior changed. The groups:

- **`core/`** — cross-cutting plumbing: `action`, `errors`, `logger`,
  `constants`, `utils`, `pagination`, `search`, `like`, `collections`.
- **`auth/`** — `auth`, `auth-client`, `admin`, `permissions` (+ `permissions.test`).
- **`schemas/`** — shared zod field primitives: `date-schema`, `id-schema`,
  `text-schema`, `url-schema`.
- **`format/`** — display + money: `format`, `currency`, `fx`.
- **`crm/`** — `company-status`, `contact-name`, `relationship-strength`,
  `opportunity`, `opportunity-pipeline`, `line-of-business`.
- **`projects/`** — `project-derived`, `project-planner-grid`,
  `project-role-status`, `project-role-type`.
- **`staff/`** — staff enums/helpers (`staff-enums`, `staff-filters`,
  `staff-employment`, `employment`, `skills`, `staff-rating`,
  `staff-rating-history`, `manual-of-me`, `ways-of-working`, `pdf-upload`) plus
  the CSV importers `staff-import/` and `pto-import/`.
- **`timesheets/`** — `timesheet-grid`, `timesheet-category`, `timesheet-status`,
  `timesheet-week`.
- **`performance/`** — `performance-stats`, `rating-stats`, `feedback-rating`.
- **`import/`** — shared CSV plumbing `csv-import/` (consumed by the two
  domain importers under `staff/`).

**`src/lib/db/` was NOT moved** — it stays the Drizzle singleton + per-domain
schema modules.

## Consequences

- **A new lib helper has an obvious home** — the domain folder that owns it (or
  `core/`/`schemas/`/`format/` if it's genuinely cross-cutting). `src/lib/`,
  `src/actions/`, and the db schema modules now share the same domain grouping.
- **Imports carry the group** (`@/lib/crm/line-of-business`,
  `@/lib/staff/skills`, `@/lib/core/action`). When editing older code or docs,
  expect the prefix; the file basenames are unchanged.
- **Client-safety discipline is unchanged.** The [ADR 0035](./0035-schema-modules-by-import-boundary.md)
  rule still holds — pure, client-importable modules (enum tuples, derived-field
  helpers) must stay `db`/drizzle-free regardless of which folder they live in.

## Alternatives considered

- **Leave it flat.** Rejected — 50 siblings gave no navigational signal and no
  convention for placing new helpers.
- **Barrel re-export shims** (`@/lib/skills` → `@/lib/staff/skills`). Rejected —
  the earlier back-compat shims were deliberately removed once (see the CRM enum
  history); a clean one-shot path rewrite avoids a second layer of indirection.
