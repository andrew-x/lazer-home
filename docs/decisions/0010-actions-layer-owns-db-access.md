# 0010 — The actions layer owns all DB access (reads too)

**Status:** accepted · 2026-06-17

## Context

[ADR 0004](./0004-action-layer.md) centralized **mutations** in the next-safe-action layer (`src/actions/**`) so auth, validation, logging, and safe errors live in one place. Reads were never given the same treatment: the first data-backed page (`/profile`) queried Drizzle directly from its Server Component. That spreads DB knowledge — column projection, ownership filtering, the "latest employment row wins" ordering — across page files, where it's easy to forget an ownership filter or leak a column, and impossible to evolve in one place.

The obvious fix — "make reads `'use server'` actions too" — is wrong for SSR. A `'use server'` action forces the `{ data, serverError }` envelope and re-runs the session/middleware chain on every call; consuming that from a Server Component during SSR is awkward (unwrap the envelope, handle `serverError` that can't happen) and redundant (the `(app)` layout already established the session). Reads need a different shape than mutations.

## Decision

**The actions layer (`src/actions/**`) is the single entry point for all DB access.** Pages, layouts, and components — including SSR Server Components — never import `db` or query Drizzle directly; they call into the actions layer.

- **Mutations** → next-safe-action actions, exactly as ADR 0004 (`'use server'`, `secureActionClient`, etc.).
- **Reads** (including SSR) → a plain **server-only** async function in the domain folder: `import "server-only"` at the top, named `get<Thing>.ts` (e.g. `src/actions/staff/getStaffProfile.ts`). **Not** a `'use server'` action — see Context. A read either resolves the current user internally *or* takes an explicit target id its caller has already authorized (the profile reads now take a `staffId`, gated at the page level — see [ADR 0011](./0011-category-agnostic-history-feed.md)); either way column projection and domain rules live in one place. It exports its return type; the page `await`s it directly and renders.

This keeps the same property ADR 0004 bought for writes: one place to authorize, project columns, and apply domain rules (e.g. the [ADR 0007](./0007-staff-employment-effective-dating.md) latest-employment ordering) — now for reads too.

**Two narrow exceptions still import `db`, and both are legitimate** — the rule is about the *call site* (feature UI), not a blanket ban:

- **Framework wiring** — the Better Auth Drizzle adapter in `src/lib/auth/auth.ts`.
- **Pure compute helpers an action delegates to** — e.g. `src/lib/*-import/plan.ts`, reached only through an action, never from a page.

**The former straggler is resolved.** `getCurrentStaff` (once in `src/lib/staff.ts`, called straight from the `(app)` layout) now lives in the actions layer as `getCurrentStaffAccess` (`src/actions/staff/getCurrentStaffAccess.ts`); `src/lib/staff.ts` is deleted. The `(app)` layout and `/profile-setup` call the actions-layer function.

## Consequences

- The `/profile` page was refactored off direct Drizzle queries into the actions layer; it now calls `getStaffProfile` / `getStaffHistory` / `getStaffProjects` / `getStaffPto` (each taking a `staffId`), with column projection and the latest-employment ordering living in the read functions. (The original `getMyProfile.ts` was self-scoped; the #33 redesign generalized these reads to any `staffId` gated at the page level — see [ADR 0011](./0011-category-agnostic-history-feed.md).)
- A future session writing an SSR read has an unambiguous pattern: `get<Thing>.ts`, `import "server-only"`, resolve user inside, export the type — not a `'use server'` action.
- Where a read scopes to the current user internally, ownership is structural, not per-page diligence: the read cannot be asked for someone else's data. (The profile reads later traded this for page-level gating so a manager/peer can view another person — see [ADR 0011](./0011-category-agnostic-history-feed.md); reads that resolve the user internally still keep the structural property.)
- Codified in `.claude/rules/server-actions.md` and `.claude/rules/database.md` ("`db` is imported only from `src/actions/**`").

## Alternatives considered

- **Reads as `'use server'` actions** — rejected: the `{ data, serverError }` envelope and re-run session checks are awkward and redundant for SSR Server Components (see Context).
- **Pages query Drizzle directly** (the prior state) — rejected: scatters ownership/projection/ordering across page files; the easy path stops being the safe one.
- **A separate `src/queries/**` tree** — rejected: splitting reads and writes for the same domain across two trees fragments the domain; co-locating `getStaffProfile.ts` beside the staff mutations keeps a domain's data access in one folder.
