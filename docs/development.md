# Development runbook

How to run this app locally without rediscovering anything. Commands are the real ones from `package.json`; values are from `.env.example`. See [architecture.md](./architecture.md) for the *why* behind the stack.

## Prerequisites

- **Bun** — runs every script and the `drizzle-kit` / `better-auth` CLIs, and auto-loads `.env` for `bun run` / `bunx`.
- **A remote Postgres (e.g. Neon).** There is no local DB — dev runs against a remote Postgres; get `DATABASE_URL` from the team. `.env.example` ships a remote placeholder (`postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require`). The `postgres` (postgres-js) driver talks to Neon over the standard endpoint.

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

## The verify loop

Run before considering a change done:

```bash
bun run check    # biome check && tsc --noEmit && bun test  → lint + types + tests
bun run build    # next build
bun run format   # biome format --write  → auto-fix formatting
```

(`bun run lint` = Biome only; `bun run typecheck` = tsc only; `bun run test` = `bun test` only.)

## Schema workflow

- Change the relevant schema module (e.g. `src/lib/db/staff-schema.ts`; `schema.ts` is just the barrel), then: `bun run db:generate` (emit SQL into `drizzle/`) → `bun run db:migrate` (apply). `db:push` is a quick-dev shortcut that skips migration files; `db:studio` opens the browser explorer.
- **Better Auth tables:** `bun run auth:generate` regenerates `src/lib/db/auth-schema.ts`; they live in our own schema/migrations, so re-run `db:generate` → `db:migrate` after.
- `drizzle.config.ts` `casing: "snake_case"` MUST stay in sync with the runtime client in `src/lib/db/db.ts`.
- **Never regenerate a migration that has already been applied.** Drizzle decides what to run by comparing each journal entry's **`when`** against the `created_at` of the matching row in the `drizzle.__drizzle_migrations` ledger. `db:generate` rewrites `when`, so re-generating an applied migration desynchronizes the two and `db:migrate` **re-runs it** (usually failing on an already-existing object and rolling back — which looks like a broken migration, not a bookkeeping bug). This actually happened to `0008_eminent_mandroid`. **Fix:** identify the ledger row by SHA-256 of the `.sql` file's contents (the ledger stores that hash, not the tag), then correct **that row's `created_at`** to the journal's `when` — don't "fix" the journal, since its value is what future clones will apply against. To change an applied migration, add a **new** one instead.

> Reminder (see the standing environment facts): **the Neon database is always migrated and up to date.** `db:generate` → `db:migrate` is the workflow for *making* a schema change, not a pending step someone still owes.

## Seeding synthetic data

`bun run db:seed` (`scripts/seed.ts` + `scripts/seed/*`) **wipes every seedable table** (`TRUNCATE ... RESTART IDENTITY CASCADE`) and reinserts a coherent, reproducible dataset across all domains — ~42 staff in a 3-tier manager hierarchy (each with one `staff_employment`, plus PTO and — for ~75% of them, deliberately not all — skills with a `skillsUpdatedAt` stamp, so completeness views have genuinely empty rows), an admin `user` linked to the staff profile for `andrew@lazertechnologies.com`, 20 companies / 40 contacts / 28 opportunities (spread across all 14 pipeline stages, each contact & opportunity seeded with a few `note` entries, and companies with ~50, via `scripts/seed/entries.ts`; companies/contacts/opportunities also get **tasks** — open + done — via `scripts/seed/tasks.ts`), 15 projects (some from closed-won opps, some with open roles; each lands in one of the **three billing states** — ~40% fixed fee, ~40% time-and-materials with a jittered rate card of which a fifth deliberately **mixes currencies**, ~20% **no budget at all**, since "No budget set" is a real permanent state worth exercising), ~60 timesheets over recent weeks (draft + submitted, entries satisfying the project-XOR-category check), 50 peer-feedback rows, staff ratings, and **two compensation plans** (one draft + one committed, 12 staff each — the committed one's planned figures deliberately differ from live comp so the frozen snapshot and the "Not applied" drift badge both have data), and **both profile surveys** (`scripts/seed/responses.ts` — Manual of Me + Ways of Working, deliberately *uneven*: some people have neither, some one, some part-way, and departed staff none, so `/people/profile-completeness` has a real spread to sort; it walks `WOW_SECTIONS` generically, so a new survey section seeds itself). Faker is seeded with a fixed value, so runs are deterministic.

Safety rails: it reads `DATABASE_URL` from the env (Bun auto-loads `.env`), **refuses if the URL looks production-ish** (contains "prod") unless `--allow-prod`, and **prompts for `y`** unless `--yes`/`-y`. It owns its own `postgres` client (does not reuse the app singleton — a documented exception to the actions-layer / "never construct a new client" rules; see `scripts/seed/client.ts` and [architecture.md](./architecture.md#data-access--the-actions-layer-is-the-only-door-to-the-db)).

**Drift guard:** the seed imports the real Drizzle tables and the `@/lib/*` enum-value sources directly, so a data-model change that outdates it surfaces as a `bun run check` (tsc) failure. **After any schema change, update `scripts/seed/` to match** and keep `check` green. `@faker-js/faker` is a devDependency.

## Modified Next.js

This is a modified Next.js 16 build — see the [concrete deltas](./architecture.md#modified-nextjs-16--concrete-deltas) (async `params`/`cookies()`/`headers()`, `unstable_retry`, image `qualities`/`preload`, `redirect()` outside try/catch) and verify APIs against `node_modules/next/dist/docs/` before writing.
