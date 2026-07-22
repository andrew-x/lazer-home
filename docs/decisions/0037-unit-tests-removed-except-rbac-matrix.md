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

## Alternatives considered

- **Keep the full pure-function suite.** Rejected — low signal relative to the
  type checker, and maintenance churn on every enum/schema tweak.
- **Delete everything including the matrix test.** Rejected — the RBAC matrix is
  the one place a silent change is a real security regression that types won't
  catch.
