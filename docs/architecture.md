# Architecture

**Status: scaffolded.** The core technical stack and architectural patterns are committed and in code. Domain features are not built yet — what exists is the foundation (env, db, auth, action layer), the **authenticated UI shell + auth screens** (see [ui.md](./ui.md)), plus one example slice (staff profile) that demonstrates the conventions.

## What we're building

A professional services automation (PSA) platform for a software consultancy — one system spanning CRM, allocations, timesheets, staff profiles, and performance management. See [data-model.md](./data-model.md) for how the domains connect.

## Tech stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Runtime | **Bun** | auto-loads `.env`; runs scripts and the drizzle-kit / better-auth CLIs |
| Framework | **Next.js 16** (a **modified** build — see [decisions/0002](./decisions/0002-modified-nextjs.md), `.claude/rules/nextjs.md`, `node_modules/next/dist/docs/`) | App Router |
| UI runtime | **React 19** (React Compiler enabled) | |
| Language | **TypeScript** | |
| Lint/format | **Biome** | `bun run lint` / `bun run format` |
| Database | **Postgres** via **postgres-js** driver (`postgres` pkg) | driver choice is postgres-js, not Neon's serverless driver — but `.env` currently points `DATABASE_URL` at a **Neon**-hosted Postgres (works over the standard endpoint); `db:migrate` against it is still pending. `.env.example` ships a local-docker default. See [decisions/0003](./decisions/0003-stack-selection.md) |
| ORM | **Drizzle** (`drizzle-orm` + `drizzle-kit`), `casing: "snake_case"` | singleton in `src/lib/db/db.ts` |
| Auth | **better-auth** — admin plugin; **Google-only** (email/password disabled) | `src/lib/auth.ts`, [0006](./decisions/0006-google-only-auth-and-layout-gating.md) |
| UI | **shadcn on Base UI** (`base-nova`), **Tabler icons** (`@tabler/icons-react`), Geist; light mode only, flat + mostly-monochrome (indigo used sparingly) | `src/components/ui/**`, `components.json` — see [ui.md](./ui.md), [0005](./decisions/0005-ui-stack.md) |
| Action layer | **next-safe-action v8** | `src/lib/action.ts` — see [decisions/0004](./decisions/0004-action-layer.md) |
| Forms | **react-hook-form** + `@hookform/resolvers` + **zod v4** | `.claude/rules/forms.md` |
| Validation | **zod v4** + **drizzle-zod** (schemas from tables) | |
| Styling | **Tailwind v4** + `clsx` + `tailwind-merge` (`cn` helper) | `src/lib/utils.ts` |
| IDs | app-minted CUID2 with prefix (`@paralleldrive/cuid2`) | `src/lib/db/ids.ts` |

## `src/` layout

```
src/
  env.ts                     zod-validated server env (see "Env" below)
  app/
    layout.tsx               root layout (fonts, metadata, TooltipProvider, Toaster)
    (app)/                   AUTHENTICATED route group — layout.tsx gates via getCurrentUser()→redirect, renders AppShell
      layout.tsx page.tsx settings/page.tsx loading.tsx
    (auth)/login/page.tsx    PUBLIC route group (Google sign-in)
    error.tsx not-found.tsx global-error.tsx   error/404 conventions (Next 16 unstable_retry — see ui.md)
    api/auth/[...all]/route.ts  better-auth catch-all (mounts the whole auth API)
  actions/<domain>/          server actions, one per file: <verb><Thing>.ts (+ .schema.ts)
    staff/updateStaffProfile.ts   example slice
  components/                React components; ui/ = vendored shadcn primitives,
                             app-shell/ + auth/ + brand/ = the UI shell; examples/ holds the demo slice
  hooks/useZodForm.tsx       RHF + zodResolver wrapper
  lib/
    action.ts                publicActionClient + secureActionClient (the core)
    auth.ts auth-client.ts   better-auth server + client; getCurrentUser/checkAuth
    errors.ts                UserSafeActionError (user-safe error channel)
    logger.ts                structured logging used by the action layer
    utils.ts                 cn()
    db/
      db.ts                  hot-reload-safe Drizzle singleton
      schema.ts              app tables + re-exports auth-schema
      auth-schema.ts         better-auth tables (generated; in OUR migrations)
      ids.ts                 generateId(prefix)
drizzle/                     generated SQL migrations
drizzle.config.ts            casing MUST match db.ts
docker-compose.yml           local Postgres
```

Path-scoped working rules live in `.claude/rules/{server-actions,database,forms,nextjs,ui}.md` and load when the matching files are touched. Read them before writing in those areas.

## Modified Next.js 16 — concrete deltas

This is a **modified** Next.js 16 build (see [decisions/0002](./decisions/0002-modified-nextjs.md)); your training data is likely wrong about it. Always confirm against `node_modules/next/dist/docs/` (the version-16 upgrade guide is the fastest index). The deltas we've actually hit and verified this session — keep this list current as more surface:

- **`params` / `searchParams` are Promises.** Route Handlers and pages receive them as promises — `await` them (`const { slug } = await props.params`). Verified in `.../upgrading/version-16.md`.
- **`cookies()` and `headers()` from `next/headers` are async.** `await` them before use.
- **`error.tsx` retry prop is `unstable_retry`, not `reset`.** (Also applies to `global-error.tsx` — see [ui.md](./ui.md).)
- **`next/image`: `priority` is deprecated → use `preload`,** and `next.config` must declare a `qualities` array (default is now only `[75]`; a `quality` prop outside the array is coerced to the nearest listed value).
- **`redirect()` must be called OUTSIDE try/catch** — it works by throwing `NEXT_REDIRECT`, so a surrounding catch will swallow it.

## Frontend / UI

The authenticated UI is **built**: shadcn on Base UI (`base-nova`), an icon-sidebar app shell, Google sign-in, and the error/404/loading conventions. Route protection is enforced in the `(app)` route-group layout (a Server Component), **not** middleware. Full details — component library, theming/tokens, the app shell, adding a nav item, and the Next 16 `unstable_retry` nuance — live in **[ui.md](./ui.md)** (and `.claude/rules/ui.md`).

## Env

`src/env.ts` validates `process.env` once at import with zod. It is **server-only by convention** but deliberately omits `import "server-only"` — drizzle-kit and the better-auth CLI run in plain Node and import the module chain (db → env), so the marker would break them. Client code must read `NEXT_PUBLIC_*` directly. Optional vars use a preprocess that coerces **blank entries (`FOO=`) to `undefined`** rather than failing on a zero-length string. Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`. Optional: `BETTER_AUTH_URL`, and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` — both must be set for sign-in to work, since Google is now the only auth method. Real Google OAuth creds and a Neon-hosted Postgres `DATABASE_URL` are configured in `.env`; **`bun run db:migrate` against that DB is still pending** before login can persist sessions.

## Auth

better-auth with the **admin** plugin; **Google-only sign-in** — `emailAndPassword` is disabled and Google is the sole social provider (see [decisions/0006](./decisions/0006-google-only-auth-and-layout-gating.md)). Server instance (`src/lib/auth.ts`) uses the Drizzle adapter over our singleton `db`; **the better-auth tables (`user`, `session`, `account`, `verification`) live in our own schema/migrations** (`auth-schema.ts`), regenerated via `bun run auth:generate`. Two helpers gate the app:

- `getCurrentUser()` — reads the session, returns the user or `null`.
- `checkAuth(role)` — throws a `UserSafeActionError` if unauthenticated or under-privileged; **admins satisfy any role requirement** (admin override). Used by the secure action middleware.

`nextCookies()` must be the last plugin so Set-Cookie flushes from server actions. The whole auth API is mounted by one catch-all route (`src/app/api/auth/[...all]/route.ts`).

**Auth UI is built.** `/login` (in the `(auth)` group) shows a single "Continue with Google" button; the `(app)` route-group **layout** (`src/app/(app)/layout.tsx`, a Server Component) gates every authenticated page by calling `getCurrentUser()` and `redirect("/login")` when there's no session — **route protection is in the layout, not middleware** (consistent with the no-middleware posture). Sign-in via `authClient.signIn.social({ provider: "google" })`, sign-out via `authClient.signOut()`. See [ui.md](./ui.md) for the screens and [decisions/0006](./decisions/0006-google-only-auth-and-layout-gating.md) for the why. Layout gating guards navigation only — server actions still authorize independently (see Authorization below).

## Authorization — two layers

Most data is sensitive (rates, salaries, reviews), so authz is first-class and applied at two levels (see the example action and `.claude/rules/server-actions.md`):

1. **Route-level** — `metadata.role` on the action → the `secureActionClient` middleware calls `checkAuth(role)`.
2. **Row-level** — ownership check inside the action body (`if (row.userId !== user.id && user.role !== "admin") throw …`).

Do both wherever data is owned.

## Running the DB

The DB is not auto-provisioned. To use it: `docker compose up -d` (local Postgres, see `docker-compose.yml`), set `DATABASE_URL`, then `bun run db:migrate` to apply migrations. Iterate with `db:generate` → `db:migrate` (or `db:push` for quick dev), browse with `db:studio`. See `.claude/rules/database.md`.

## Cross-cutting concerns

- **Authorization** — see the two-layer model above. Role-based, not an afterthought.
- **Time** — allocations and timesheets are inherently time-ranged; date/timezone handling needs a deliberate approach.
- **Auditing** — financial and performance data likely need change history.

## Open questions

- Single-tenant (one consultancy) or multi-tenant? Assumed **single-tenant internal** until told otherwise.
- Billing: does this platform invoice, or just produce the billing basis for another system?
- Integrations: HR, accounting, calendars?
