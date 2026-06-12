# Development runbook

How to run this app locally without rediscovering anything. Commands are the real ones from `package.json`; values are from `.env.example`. See [architecture.md](./architecture.md) for the *why* behind the stack.

## Prerequisites

- **Bun** — runs every script and the `drizzle-kit` / `better-auth` CLIs, and auto-loads `.env` for `bun run` / `bunx`.
- **A Postgres database.** `.env.example` ships a local-docker default (`docker compose up -d`, see `docker-compose.yml`). The project's own `.env` currently points `DATABASE_URL` at a **Neon**-hosted Postgres — the `postgres` (postgres-js) driver talks to it over the standard endpoint. Either works.

## Env setup

Copy the template and fill it in:

```bash
cp .env.example .env
```

`src/env.ts` validates these at import (blank values like `FOO=` are coerced to unset):

- **Required:** `DATABASE_URL`, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`).
- **Optional:** `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` (default `http://localhost:3000`).
- **Google sign-in (the only auth method):** set **both** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. In Google Cloud, register the redirect URI **`http://localhost:3000/api/auth/callback/google`**. Without both vars, the sign-in button won't work.

## First run

```bash
bun install
bun run db:migrate   # apply Drizzle migrations to DATABASE_URL
bun run dev          # next dev → http://localhost:3000
```

> **Heads-up:** migrations have **not** been applied to the Neon DB yet. Until `bun run db:migrate` succeeds against it, the Better Auth tables (`user`, `session`, `account`, `verification`) don't exist, so **login won't work** (sessions can't persist).

## The verify loop

Run before considering a change done:

```bash
bun run check    # biome check && tsc --noEmit
bun run build    # next build
bun run format   # biome format --write  → auto-fix formatting
```

(`bun run lint` = Biome only; `bun run typecheck` = tsc only.)

## Schema workflow

- Change `src/lib/db/schema.ts`, then: `bun run db:generate` (emit SQL into `drizzle/`) → `bun run db:migrate` (apply). `db:push` is a quick-dev shortcut that skips migration files; `db:studio` opens the browser explorer.
- **Better Auth tables:** `bun run auth:generate` regenerates `src/lib/db/auth-schema.ts`; they live in our own schema/migrations, so re-run `db:generate` → `db:migrate` after.
- `drizzle.config.ts` `casing: "snake_case"` MUST stay in sync with the runtime client in `src/lib/db/db.ts`.

## Modified Next.js

This is a modified Next.js 16 build — see the [concrete deltas](./architecture.md#modified-nextjs-16--concrete-deltas) (async `params`/`cookies()`/`headers()`, `unstable_retry`, image `qualities`/`preload`, `redirect()` outside try/catch) and verify APIs against `node_modules/next/dist/docs/` before writing.
