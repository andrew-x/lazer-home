# Architecture

**Status: scaffolded.** The core technical stack and architectural patterns are committed and in code. Domain features are not built yet — what exists is the foundation (env, db, auth, action layer), the **authenticated UI shell + auth screens** (see [ui.md](./ui.md)), and the **staff schema + post-login staff-record gate** (the first real data-model slice; the earlier `StaffProfileForm`/`updateStaffProfile` demo has been deleted). The first real data-backed authenticated pages are **`/profile`** ("My profile") and the **browse-staff** feature — a directory (`/staff`) and per-person profiles (`/staff/[id]`) that show *other* people via the same shared `ProfileView` (see [ui.md](./ui.md)) — the first place all three call-site patterns from ADR 0010 appear together (server-only read, next-safe-action mutation, presentational client UI). Browse-staff is also the first **cross-person** data access: its reads aren't ownership-scoped and its link/intro edits are temporarily open to any signed-in user (see Authorization and [ADR 0012](./decisions/0012-open-staff-edit-pending-rbac.md)).

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
| Database | **Postgres** via **postgres-js** driver (`postgres` pkg) | driver choice is postgres-js, not Neon's serverless driver — but `.env` currently points `DATABASE_URL` at a **Neon**-hosted Postgres (works over the standard endpoint); `db:migrate` against it is still pending. Dev runs against a remote Postgres (no local DB / Docker); `.env.example` ships a remote placeholder. See [decisions/0003](./decisions/0003-stack-selection.md) |
| ORM | **Drizzle** (`drizzle-orm` + `drizzle-kit`), `casing: "snake_case"` | singleton in `src/lib/db/db.ts` |
| Auth | **better-auth** — admin plugin; **Google-only** (email/password disabled) | `src/lib/auth.ts`, [0006](./decisions/0006-google-only-auth-and-layout-gating.md) |
| UI | **shadcn on Base UI** (`base-nova`), **Tabler icons** (`@tabler/icons-react`), Geist; light mode only, flat + mostly-monochrome (indigo used sparingly) | `src/components/ui/**`, `components.json` — see [ui.md](./ui.md), [0005](./decisions/0005-ui-stack.md) |
| Action layer | **next-safe-action v8** | `src/lib/action.ts` — see [decisions/0004](./decisions/0004-action-layer.md) |
| Forms | **react-hook-form** + `@hookform/resolvers` + **zod v4** | `.claude/rules/forms.md` |
| Validation | **zod v4** + **drizzle-zod** (schemas from tables) | |
| Styling | **Tailwind v4** + `clsx` + `tailwind-merge` (`cn` helper) | `src/lib/utils.ts` |
| IDs | app-minted CUID2 with prefix (`@paralleldrive/cuid2`) | `src/lib/db/ids.ts` |
| Tables / CSV | **@tanstack/react-table** (+ shadcn `table`/`badge`), **papaparse** | added for the admin staff import; `src/components/admin/data-table.tsx` is the reusable wrapper |

## `src/` layout

```
src/
  env.ts                     zod-validated server env (see "Env" below)
  app/
    layout.tsx               root layout (fonts, metadata, TooltipProvider, Toaster)
    (app)/                   AUTHENTICATED route group — layout.tsx gates via getCurrentUser() + getCurrentStaff()→redirect, renders AppShell
      layout.tsx page.tsx profile/page.tsx settings/page.tsx loading.tsx
    (onboarding)/            POST-LOGIN block screen — authed users without a usable staff record (no group layout; page self-gates)
      profile-setup/page.tsx
    (auth)/login/page.tsx    PUBLIC route group (Google sign-in)
    admin/                   LOCALHOST-ONLY tooling — OUTSIDE (app) on purpose; layout 404s non-loopback requests
      layout.tsx page.tsx upload-staff/page.tsx upload-pto/page.tsx bulk-edit-roles/page.tsx
    error.tsx not-found.tsx global-error.tsx   error/404 conventions (Next 16 unstable_retry — see ui.md)
    api/auth/[...all]/route.ts  better-auth catch-all (mounts the whole auth API)
  actions/<domain>/          the single entry point for ALL DB access (ADR 0010)
    staff/getStaffProfile.ts staff/getStaffHistory.ts staff/getStaffPto.ts staff/getStaffAvatar.ts  per-person reads by id (server-only get<Thing>.ts), NOT ownership-scoped
    staff/getStaffDirectory.ts  directory read: latest-employment-per-staff (two queries, no N+1) + filter options
    staff/getCurrentStaffId.ts  session→staff id (React.cache); getMy* wrappers delegate to the getStaff* cores
    staff/getStaffEmploymentForEdit.ts  latest employment row per staff for the bulk-edit table (server-only)
    staff/updateStaffLinks.ts staff/updateStaffClientIntro.ts  edit-by-staffId mutations (+ .schema.ts); open to any signed-in user for now (ADR 0012)
    <domain>/<verb><Thing>.ts  mutations → next-safe-action, one per file (+ .schema.ts)
    admin/                   {preview,commit}StaffImport + {preview,commit}PtoImport + commitBulkEditEmployment (publicActionClient + assertLocalhost)
  components/                React components; ui/ = vendored shadcn primitives,
                             app-shell/ + auth/ + brand/ = the UI shell, admin/ = staff-import + pto-import + bulk-edit-roles UI,
                             staff/ = shared ProfileView (backs /profile + /staff/[id]) + directory/cards + edit dialogs + history sheet
  hooks/useZodForm.tsx       RHF + zodResolver wrapper
  lib/
    action.ts                publicActionClient + secureActionClient (the core)
    auth.ts auth-client.ts   better-auth server + client; getCurrentUser/checkAuth
    staff.ts                 getCurrentStaff(user) — resolves user→staff, email auto-link, StaffAccessStatus gate
    errors.ts                UserSafeActionError (user-safe error channel)
    logger.ts                structured logging used by the action layer
    utils.ts                 cn()
    format.ts                humanizeEnum() + formatDate() — display helpers (timezone-safe date formatting)
    admin.ts                 isLocalhost()/assertLocalhost() — the admin-area security boundary (host header)
    staff-import/            CSV staff import: transform.ts (pure), plan.ts (server diff), types.ts (shared zod)
    pto-import/              CSV PTO import (same shape as staff-import): transform.ts / plan.ts / types.ts
    db/
      db.ts                  hot-reload-safe Drizzle singleton
      schema.ts              barrel: re-exports auth-schema + staff-schema (one import for the whole schema)
      staff-schema.ts        staff / staff_employment / staff_pto + domain enums
      auth-schema.ts         better-auth tables (generated; in OUR migrations)
      ids.ts                 generateId(prefix)
drizzle/                     generated SQL migrations
drizzle.config.ts            casing MUST match db.ts
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

## Admin area (localhost-only)

`src/app/admin/**` is a **local-only tooling surface** for data seeding/maintenance, all into the staff-profiles domain (see [staff-profiles.md](./domains/staff-profiles.md)): two CSV importers — staff (`upload-staff`) and PTO (`upload-pto`) — plus a **bulk employment editor** (`bulk-edit-roles`) that maintains existing `staff_employment` rows (in-place correction or new effective-dated rows; the only in-app way to edit employment facts — see [ADR 0007](./decisions/0007-staff-employment-effective-dating.md)). Two deliberate choices:

- **Outside the `(app)` route group, on purpose.** The `(app)` layout redirects users without an active staff record to `/profile-setup`; the staff-upload tool is exactly what *creates* those records (chicken-and-egg). So admin must NOT require auth/staff — it requires only that the request is local.
- **The security boundary is the host, not auth.** `src/lib/admin.ts` exports `isLocalhost()` / `assertLocalhost()`, which check the request `host` header against loopback hosts (`localhost`, `127.0.0.1`, `::1`). `admin/layout.tsx` calls `isLocalhost()` and `notFound()`s the whole segment for non-local requests; every admin action is `publicActionClient` + `assertLocalhost()` (NOT `secureActionClient`). Enforced server-side only — never trusted from the client. Reachable by direct URL; there's no sidebar nav entry. See [ADR 0008](./decisions/0008-localhost-only-admin-area.md).

## Env

`src/env.ts` validates `process.env` once at import with zod. It is **server-only by convention** but deliberately omits `import "server-only"` — drizzle-kit and the better-auth CLI run in plain Node and import the module chain (db → env), so the marker would break them. Client code must read `NEXT_PUBLIC_*` directly. Optional vars use a preprocess that coerces **blank entries (`FOO=`) to `undefined`** rather than failing on a zero-length string. Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`. Optional: `BETTER_AUTH_URL`, and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` — both must be set for sign-in to work, since Google is now the only auth method. Real Google OAuth creds and a Neon-hosted Postgres `DATABASE_URL` are configured in `.env`; **`bun run db:migrate` against that DB is still pending** before login can persist sessions.

## Auth

better-auth with the **admin** plugin; **Google-only sign-in** — `emailAndPassword` is disabled and Google is the sole social provider (see [decisions/0006](./decisions/0006-google-only-auth-and-layout-gating.md)). Server instance (`src/lib/auth.ts`) uses the Drizzle adapter over our singleton `db`; **the better-auth tables (`user`, `session`, `account`, `verification`) live in our own schema/migrations** (`auth-schema.ts`), regenerated via `bun run auth:generate`. Two helpers gate the app:

- `getCurrentUser()` — reads the session, returns the user or `null`.
- `checkAuth(role)` — throws a `UserSafeActionError` if unauthenticated or under-privileged; **admins satisfy any role requirement** (admin override). Used by the secure action middleware.

`nextCookies()` must be the last plugin so Set-Cookie flushes from server actions. The whole auth API is mounted by one catch-all route (`src/app/api/auth/[...all]/route.ts`).

**Auth UI is built.** `/login` (in the `(auth)` group) shows a single "Continue with Google" button; the `(app)` route-group **layout** (`src/app/(app)/layout.tsx`, a Server Component) gates every authenticated page by calling `getCurrentUser()` and `redirect("/login")` when there's no session — **route protection is in the layout, not middleware** (consistent with the no-middleware posture). Sign-in via `authClient.signIn.social({ provider: "google" })`, sign-out via `authClient.signOut()`. See [ui.md](./ui.md) for the screens and [decisions/0006](./decisions/0006-google-only-auth-and-layout-gating.md) for the why. Layout gating guards navigation only — server actions still authorize independently (see Authorization below).

**Beyond a session, the app gates on a usable staff record.** After the session check, the `(app)` layout calls `getCurrentStaff(user)` (`src/lib/staff.ts`), which resolves the user to a `staff` row and returns a discriminated `StaffAccessStatus` (`ok` | `incomplete` | `not_setup`). Only `ok` (active staff record with ≥1 employment row) enters the app; the others redirect to the single `/profile-setup` block screen (`(onboarding)` route group, no group layout — the page self-gates). On first login it auto-links the email-synced staff row by writing `staff.userId` (guarded on `userId IS NULL`). See [flows.md](./flows.md) (auth flow), the [staff-profiles domain doc](./domains/staff-profiles.md), and [decisions/0006](./decisions/0006-google-only-auth-and-layout-gating.md).

## Data access — the actions layer is the only door to the DB

`db` is imported **only from `src/actions/**`**. Pages, layouts, and components — **including SSR Server Components** — never import `db` or query Drizzle directly; they call into the actions layer. This keeps every read and write in one place to authorize, project columns, and apply domain rules. See [ADR 0010](./decisions/0010-actions-layer-owns-db-access.md), `.claude/rules/server-actions.md`, `.claude/rules/database.md`.

- **Mutations** → next-safe-action actions (the action layer below / [ADR 0004](./decisions/0004-action-layer.md)).
- **Reads (incl. SSR)** → a plain **server-only** async function in the domain folder: `import "server-only"`, named `get<Thing>.ts` (e.g. `src/actions/staff/getStaffProfile.ts`, which `/staff/[id]` `await`s). **Not** a `'use server'` action — that would force the `{ data, serverError }` envelope and re-run session checks, awkward for SSR. It exports its return type. Personal reads resolve the user inside and filter by ownership (inherently scoped); **cross-person reads** (the staff directory and `/staff/[id]`) take an id and are **not** scoped — the `(app)` layout gate is their boundary (see Authorization, [ADR 0012](./decisions/0012-open-staff-edit-pending-rbac.md)).

**Legitimate `db` importers outside `actions/`:** framework wiring (the Better Auth Drizzle adapter in `src/lib/auth.ts`) and pure compute helpers an action delegates to (`src/lib/*-import/plan.ts`, reached only through an action). **One known straggler:** `getCurrentStaff` (`src/lib/staff.ts`) is called straight from the `(app)` layout — fold it into the actions layer when next touched.

## Authorization — two layers

Most data is sensitive (rates, salaries, reviews), so authz is first-class and applied at two levels (see the example action and `.claude/rules/server-actions.md`):

1. **Route-level** — `metadata.role` on the action → the `secureActionClient` middleware calls `checkAuth(role)`.
2. **Row-level** — ownership check inside the action body (`if (row.userId !== user.id && user.role !== "admin") throw …`).

Do both wherever data is owned.

> **Known temporary gap:** the browse-staff link/intro edits (`updateStaffLinks`/`updateStaffClientIntro`) **drop the row-level layer** — any signed-in user can edit any staff member's links/intro, and the directory/profile reads aren't scoped either. Accepted knowingly to ship the directory before the role model exists; lock down when RBAC lands (search `// TODO: lock down to owner/admin later`). See [ADR 0012](./decisions/0012-open-staff-edit-pending-rbac.md).

## Running the DB

The DB is not auto-provisioned. Dev uses a **remote Postgres** (e.g. Neon) — there is no local DB. Set `DATABASE_URL` (get it from the team), then `bun run db:migrate` to apply migrations. Iterate with `db:generate` → `db:migrate` (or `db:push` for quick dev), browse with `db:studio`. See `.claude/rules/database.md`.

## Cross-cutting concerns

- **Authorization** — see the two-layer model above. Role-based, not an afterthought.
- **Time** — allocations and timesheets are inherently time-ranged; date/timezone handling needs a deliberate approach.
- **Auditing** — financial and performance data likely need change history.

## Open questions

- Single-tenant (one consultancy) or multi-tenant? Assumed **single-tenant internal** until told otherwise.
- Billing: does this platform invoice, or just produce the billing basis for another system?
- Integrations: HR, accounting, calendars?
