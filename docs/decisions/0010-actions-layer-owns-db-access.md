# 0010 — The actions layer owns all DB access (reads too)

**Status:** accepted · 2026-06-17

## Context

[ADR 0004](./0004-action-layer.md) centralized **mutations** in the next-safe-action layer (`src/actions/**`) so auth, validation, logging, and safe errors live in one place. Reads were never given the same treatment: the first data-backed page (`/profile`) queried Drizzle directly from its Server Component. That spreads DB knowledge — column projection, ownership filtering, the "latest employment row wins" ordering — across page files, where it's easy to forget an ownership filter or leak a column, and impossible to evolve in one place.

The obvious fix — "make reads `'use server'` actions too" — is wrong for SSR. A `'use server'` action forces the `{ data, serverError }` envelope and re-runs the session/middleware chain on every call; consuming that from a Server Component during SSR is awkward (unwrap the envelope, handle `serverError` that can't happen) and redundant (the `(app)` layout already established the session). Reads need a different shape than mutations.

## Decision

**The actions layer (`src/actions/**`) is the single entry point for all DB access.** Pages, layouts, and components — including SSR Server Components — never import `db` or query Drizzle directly; they call into the actions layer.

- **Mutations** → next-safe-action actions, exactly as ADR 0004 (`'use server'`, `secureActionClient`, etc.).
- **Reads** (including SSR) → a plain **server-only** async function in the domain folder: `import "server-only"` at the top, named `get<Thing>.ts` (first example: `src/actions/staff/getMyProfile.ts`). **Not** a `'use server'` action — see Context. It resolves the current user internally (`getCurrentUser`) and filters by ownership (`where staff.userId = user.id`) so results are **inherently scoped**; a caller cannot widen them. It exports its return type; the page `await`s it directly and renders.

This keeps the same property ADR 0004 bought for writes: one place to authorize, project columns, and apply domain rules (e.g. the [ADR 0007](./0007-staff-employment-effective-dating.md) latest-employment ordering) — now for reads too.

**Two narrow exceptions still import `db`, and both are legitimate** — the rule is about the *call site* (feature UI), not a blanket ban:

- **Framework wiring** — the Better Auth Drizzle adapter in `src/lib/auth.ts`.
- **Pure compute helpers an action delegates to** — e.g. `src/lib/*-import/plan.ts`, reached only through an action, never from a page.

**One known straggler:** `getCurrentStaff` in `src/lib/staff.ts` is called straight from the `(app)` layout (not via the actions layer). It predates this convention; fold it into the actions layer when next touched.

## Consequences

- The `/profile` page was refactored to call `getMyProfile()` instead of querying Drizzle; ownership filtering and the latest-employment ordering moved into the read function.
- A future session writing an SSR read has an unambiguous pattern: `get<Thing>.ts`, `import "server-only"`, resolve user inside, export the type — not a `'use server'` action.
- Ownership becomes structural, not per-page diligence: the read function scopes by `userId`, so a page literally cannot ask for someone else's data.
- Codified in `.claude/rules/server-actions.md` and `.claude/rules/database.md` ("`db` is imported only from `src/actions/**`").

## Alternatives considered

- **Reads as `'use server'` actions** — rejected: the `{ data, serverError }` envelope and re-run session checks are awkward and redundant for SSR Server Components (see Context).
- **Pages query Drizzle directly** (the prior state) — rejected: scatters ownership/projection/ordering across page files; the easy path stops being the safe one.
- **A separate `src/queries/**` tree** — rejected: splitting reads and writes for the same domain across two trees fragments the domain; co-locating `getMyProfile.ts` beside the staff mutations keeps a domain's data access in one folder.
