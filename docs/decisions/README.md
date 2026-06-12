# Architecture Decision Records (ADRs)

Short records of decisions that shape the system — capturing the **why** and the alternatives considered, so future sessions don't relitigate settled choices or undo them unknowingly.

## Format

One file per decision, numbered: `NNNN-short-title.md`. Each has: **Status** (proposed / accepted / superseded), **Context**, **Decision**, **Consequences**. The librarian adds ADRs when a non-obvious choice is made.

## Log

| # | Title | Status |
|---|-------|--------|
| [0001](./0001-record-architecture-decisions.md) | Record architecture decisions | accepted |
| [0002](./0002-modified-nextjs.md) | The pinned Next.js is modified — verify against bundled docs | accepted |
| [0003](./0003-stack-selection.md) | Core stack selection (plain Postgres, not Neon) | accepted |
| [0004](./0004-action-layer.md) | Action layer: two-client composition + UserSafeActionError | accepted |
| [0005](./0005-ui-stack.md) | UI stack: shadcn on Base UI (base-nova), indigo light theme | accepted |
| [0006](./0006-google-only-auth-and-layout-gating.md) | Google-only auth + route-group/server-layout gating (not middleware) | accepted |
