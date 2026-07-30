# 0037 — Unit tests removed, except the RBAC permission-matrix test

**Status:** accepted · 2026-07-21

## Context

A handful of pure-function `*.test.ts` files had accumulated under `src/lib/`
alongside the modules they covered — `company-status`, `date-schema`, `fx`,
`opportunity-pipeline`, `performance-stats`, `project-derived`,
`project-planner-grid`, `rating-stats`, `skills`, `timesheet-grid`, and the two
`staff-import` helpers (`managers`, `transform`). These exercised mechanical
transforms (enum ordering, date parsing, grid math, aggregation) that the
TypeScript type checker and Biome already largely constrain, and they were extra
surface to keep green on every schema/enum change.

## Decision

**Delete the pure-function unit tests. Keep exactly one test:
`src/lib/auth/permissions.test.ts`** — the RBAC matrix test.

The permission matrix is a **security invariant the type system cannot express**:
that each role maps to exactly the capabilities its row in the matrix grants, no
more. AGENTS.md and [ADR 0014](./0014-rbac-better-auth-access-control.md) already
require the matrix, `permissions.test.ts`, and
[docs/domains/permissions.md](../domains/permissions.md) to change in lockstep,
and the test is what enforces that lockstep. It stays, and it still runs in
`bun run check` (via `bun test`).

## Consequences

- **`bun run check` = Biome lint + `tsc --noEmit` + the RBAC matrix test.** There
  is no broad unit-test suite; correctness of the pure helpers rests on types,
  the reviewer, and (for shape invariants like the pipeline order) the
  **module-load assertions** that some modules still run at import time
  (e.g. `opportunity-pipeline`).
- **Don't reflexively re-add unit tests** for pure helpers as if the suite
  regressed — their absence is intentional. If a specific helper's behavior is
  genuinely hard to guarantee by types/review, that's a case to raise, not a gap
  to silently backfill.
- **Never delete or weaken `permissions.test.ts`.** It is the one required test
  and the guardrail on the access-control matrix.

## Update (2026-07-27)

"Keep exactly one test" has softened in practice into "the RBAC matrix test is the
one that must never go — plus a *small, deliberate* set of invariant tests." A few
`*.test.ts` files have since been (re-)added where a correctness invariant is
**genuinely beyond the type checker**: `allocations-grid`, `timesheet-grid`,
`timesheet-week`, `project-derived`, `compensation-plan`, and `org-chart`. The last
pins `buildOrgForest`'s structural contract — every input row appears in the output
exactly once, and a self-reference / dangling id / cycle in `staff.managerId` can
neither hang the page nor drop a subtree ([ADR 0054](./0054-staff-org-chart-dom-tree.md)) —
which no type can state. `project-derived` asserts that the derived-status
**SQL bucket filter** (`src/lib/projects/project-status-sql.ts`) agrees with its pure
JS mirror `statusesMatchBucket` and with `deriveProjectStatus`, across all 16
role-status presence combinations — a cross-representation (SQL↔JS) invariant types
can't express, exactly the "raise it as a case" exception the Consequences anticipated.
This is **not** a return to a broad pure-function suite; the "don't reflexively re-add
unit tests" guidance still holds, and **`permissions.test.ts` remains the one test that
must never be deleted or weakened.**

## Alternatives considered

- **Keep the full pure-function suite.** Rejected — low signal relative to the
  type checker, and maintenance churn on every enum/schema tweak.
- **Delete everything including the matrix test.** Rejected — the RBAC matrix is
  the one place a silent change is a real security regression that types won't
  catch.
