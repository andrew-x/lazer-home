# 0003 — Core stack selection

**Status:** accepted · 2026-06-12

Supersedes the "open / undecided" rows in earlier [architecture.md](../architecture.md) (DB, ORM, auth, UI).

## Context

The platform was greenfield with DB, ORM, auth, and UI all explicitly left open (see [0001](./0001-record-architecture-decisions.md)). Patterns were adapted from a prior source project that ran on **Neon** (serverless Postgres). We needed to commit to a stack to start building.

## Decision

- **Postgres** (relational, multi-entity model fits) accessed via the **postgres-js** driver (`postgres` pkg) — **plain Postgres, NOT Neon.**
- **Drizzle** ORM + drizzle-kit migrations, `casing: "snake_case"`.
- **better-auth** (admin plugin + email/password; Google OAuth optional behind env). *(Email/password was later disabled in favour of Google-only auth — see [0006](./0006-google-only-auth-and-layout-gating.md).)*
- **next-safe-action v8** for the mutation layer (see [0004](./0004-action-layer.md)).
- **react-hook-form** + `@hookform/resolvers` + **zod v4** (+ drizzle-zod) for forms/validation.
- **Tailwind v4** + `clsx` + `tailwind-merge` (`cn`) for styling.
- Runtime **Bun**, **Next 16**, **React 19**, **Biome**.

### Why plain Postgres instead of the source project's Neon

The source project used Neon's serverless/HTTP driver, which suits edge/serverless deploys. This project runs a standard Node/Bun server, so a normal TCP driver (postgres-js) is simpler, has no per-query HTTP overhead, and avoids a vendor lock-in we don't need — even when the Postgres itself is Neon-hosted, postgres-js talks to it over the standard endpoint. The Drizzle client is a hot-reload-safe singleton (`src/lib/db/db.ts`) — connection pooling is handled in-process rather than delegated to a serverless proxy.

**Update 2026-06-17:** local-Docker dev was dropped. Dev now runs against a **remote Postgres** (Neon) — `docker-compose.yml` was deleted and `.env.example` ships a remote placeholder. The driver choice (postgres-js, not Neon's serverless driver) is unchanged.

## Consequences

- Need a reachable Postgres + `bun run db:migrate` before the app can touch data (dev: a remote Postgres — see the 2026-06-17 update above). Not auto-provisioned.
- `casing: "snake_case"` must stay in sync between `src/lib/db/db.ts` and `drizzle.config.ts`.
- better-auth tables live in OUR schema/migrations (`auth-schema.ts`, regenerated via `bun run auth:generate`), not managed externally.
- If a future deploy target is serverless/edge, the driver choice (not the ORM) would be the thing to revisit.
