# Architecture

**Status: scaffolded, first domain slices landing.** The core technical stack and architectural patterns are committed and in code. What exists is the foundation (env, db, auth, action layer), the **authenticated UI shell + auth screens** (see [ui.md](./ui.md)), the **staff schema + post-login staff-record gate** (the first real data-model slice; the earlier `StaffProfileForm`/`updateStaffProfile` demo has been deleted), and a growing **CRM slice** (`companies`/`contacts`/`opportunities` data, reads, create actions, and `/companies` + `/opportunities` pages — see [domains/crm.md](./domains/crm.md)). The first real data-backed authenticated pages are **`/profile`** ("My profile") and the **browse-staff** feature — a directory (`/staff`) and per-person profiles (`/staff/[id]`) that show *other* people via the same shared `ProfileView` (see [ui.md](./ui.md)) — the first place all three call-site patterns from ADR 0010 appear together (server-only read, next-safe-action mutation, presentational client UI). Browse-staff is also the first **cross-person** data access: its reads aren't ownership-scoped, and its link/intro/resume edits are now gated by RBAC (own → always; other → the `staff.edit` permission) — see Authorization, [domains/permissions.md](./domains/permissions.md), and [ADR 0014](./decisions/0014-rbac-better-auth-access-control.md). The resume edit is a **two-step parse-then-store** flow (upload a PDF → server extracts text for review → user saves), which never persists the file — see [ADR 0013](./decisions/0013-resume-pdf-parse-not-store.md). The CRM slice adds the first **server-side-paginated** reads (`src/lib/pagination.ts`) and the first type-ahead search (`src/lib/search.ts`), plus the first flat (non-ownership) write gate: a single `crm.edit` capability gates all CRM writes (companies, contacts *and* opportunities), while reads stay open to any signed-in user. Opportunities also bring the repo's first **many-to-many junction tables** (see [data-model.md](./data-model.md#junction-tables--the-first-many-to-many-pattern)) and the first CRM ↔ staff link. A **Projects slice** (`projects`/`project_delivery_managers`/`project_roles` data, a server-paginated read, a `projects.edit`-gated create, and the `/projects` page — see [domains/projects.md](./domains/projects.md)) follows next: it reuses the junction/shared-enum conventions, adds the first **data-carrying junction** (`project_roles`, the first cut of Allocation — [ADR 0017](./decisions/0017-project-roles-as-first-allocation-cut.md)), a second flat write capability (`projects.edit`), and shares its staff/company search query bodies with CRM via `src/actions/shared/entitySearch.ts`. The first **Performance** slice — **peer feedback** — has also shipped: a `feedback` table (`performance-schema.ts`), give/read actions, and a `/feedback` page, with **three privacy tiers enforced in the read projections** (giving is open to any active staff, recipients see a limited view, `feedback.review` sees everything) — see [domains/performance.md](./domains/performance.md), [data-model.md](./data-model.md), and [ADR 0023](./decisions/0023-feedback-privacy-tiers.md). A **Timesheets slice** has also shipped: `timesheets`/`time_entries` (`timesheets-schema.ts`), the `/timesheets` weekly grid, and save/submit/reopen actions — the first **actuals** capture (per-day rows, whole-week transactional replace, submit-locks-the-week, a ±1-week owner edit window with the `timesheets.edit` capability bypassing it). No approval or billing yet — see [domains/timesheets.md](./domains/timesheets.md) and [ADR 0025](./decisions/0025-timesheet-weekly-model-and-edit-window.md).

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
| Database | **Postgres** via **postgres-js** driver (`postgres` pkg) | driver choice is postgres-js, not Neon's serverless driver — `.env` points `DATABASE_URL` at a **Neon**-hosted Postgres (works over the standard endpoint), which is migrated and up to date. Dev runs against a remote Postgres (no local DB / Docker); `.env.example` ships a remote placeholder. See [decisions/0003](./decisions/0003-stack-selection.md) |
| ORM | **Drizzle** (`drizzle-orm` + `drizzle-kit`), `casing: "snake_case"` | singleton in `src/lib/db/db.ts` |
| Auth | **better-auth** — admin plugin; **Google-only** (email/password disabled) | `src/lib/auth.ts`, [0006](./decisions/0006-google-only-auth-and-layout-gating.md) |
| UI | **shadcn on Base UI** (`base-nova`), **Tabler icons** (`@tabler/icons-react`), Geist; light mode only, flat + mostly-monochrome (indigo used sparingly) | `src/components/ui/**`, `components.json` — see [ui.md](./ui.md), [0005](./decisions/0005-ui-stack.md) |
| Action layer | **next-safe-action v8** | `src/lib/action.ts` — see [decisions/0004](./decisions/0004-action-layer.md) |
| Forms | **react-hook-form** + `@hookform/resolvers` + **zod v4** | `.claude/rules/forms.md` |
| Validation | **zod v4** + **drizzle-zod** (schemas from tables) | |
| Styling | **Tailwind v4** + `clsx` + `tailwind-merge` (`cn` helper) | `src/lib/utils.ts` |
| IDs | app-minted CUID2 with prefix (`@paralleldrive/cuid2`) | `src/lib/db/ids.ts` |
| Tables / CSV | **@tanstack/react-table** (+ shadcn `table`/`badge`), **papaparse**, **unpdf** (PDF text extraction, `parseResumePdf`) | tables added for the admin importers; `src/components/admin/data-table.tsx` (read-only) + `editable-table.tsx` + shared `csv-import.tsx` are the reusable wrappers |
| Drag & drop | **@dnd-kit** (`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`) | powers the opportunities kanban drag-reorder — see [ADR 0021](./decisions/0021-opportunity-pipeline-groups-and-fractional-ordering.md), [ui.md](./ui.md) |

## `src/` layout

```
src/
  env.ts                     zod-validated server env (see "Env" below)
  app/
    layout.tsx               root layout (fonts, metadata, TooltipProvider, Toaster)
    (app)/                   AUTHENTICATED route group — layout.tsx gates via getCurrentUser() + getCurrentStaff()→redirect, renders AppShell
      layout.tsx page.tsx profile/page.tsx settings/page.tsx loading.tsx
      staff/page.tsx staff/[id]/page.tsx  companies/page.tsx contacts/page.tsx opportunities/page.tsx projects/page.tsx
      feedback/page.tsx feedback/new/page.tsx feedback/[id]/page.tsx  (peer feedback — two-tab list, give-feedback page, detail)
    (onboarding)/            POST-LOGIN block screen — authed users without a usable staff record (no group layout; page self-gates)
      profile-setup/page.tsx
    (auth)/login/page.tsx    PUBLIC route group (Google sign-in)
    admin/                   LOCALHOST-ONLY tooling — OUTSIDE (app) on purpose; layout 404s non-loopback requests
      layout.tsx page.tsx upload-staff/page.tsx upload-pto/page.tsx bulk-edit-roles/page.tsx manage-users/page.tsx
    error.tsx not-found.tsx global-error.tsx   error/404 conventions (Next 16 unstable_retry — see ui.md)
    api/auth/[...all]/route.ts  better-auth catch-all (mounts the whole auth API)
  actions/<domain>/          the single entry point for ALL DB access (ADR 0010)
    staff/getStaffProfile.ts staff/getStaffHistory.ts staff/getStaffPto.ts staff/getStaffAvatar.ts  per-person reads by id (server-only get<Thing>.ts), NOT ownership-scoped
    staff/getStaffDirectory.ts  directory read: latest-employment-per-staff (two queries, no N+1) + filter options
    staff/getCurrentStaffId.ts  session→staff id (React.cache); getMy* wrappers delegate to the getStaff* cores
    staff/getStaffEmploymentForEdit.ts  latest employment row per staff for the bulk-edit table (server-only)
    staff/updateStaffLinks.ts staff/updateStaffClientIntro.ts staff/updateStaffResume.ts  edit-by-staffId mutations (+ .schema.ts); use metadata({ authorize: authorizeStaffEdit }) — authz runs in the client, not the body
    staff/parseResumePdf.ts  (+ .schema.ts) PDF→text extraction (unpdf) for the resume dialog; DOES NOT touch the DB — two-step parse-then-store (ADR 0013)
    staff/canEditStaff.ts  staff-edit authz (ADR 0014): canEditStaff(user, staffId) → boolean (UI affordance) + authorizeStaffEdit (ActionAuthorize hook reading clientInput.staffId; own → always, other → staff.edit)
    <domain>/<verb><Thing>.ts  mutations → next-safe-action, one per file (+ .schema.ts)
    admin/                   {preview,commit}StaffImport + {preview,commit}PtoImport + commitBulkEditEmployment (publicActionClient + assertLocalhost); getUsers + commitUserChanges (manage-users: secureActionClient role:admin + assertLocalhost, mutates via Better Auth admin API); promoteSelfToAdmin (secureActionClient + assertLocalhost — the ONE deliberate direct-column role write, first-admin bootstrap escape hatch)
    crm/                     get{Companies,Contacts,Opportunities}Page (server-only, server-side paginated, open reads) + search{Companies,Contacts,Staff} (type-ahead) + create{Company,Contact,Opportunity} — all writes gated crm.edit (+.schema.ts; createOpportunity.schema.ts is the single source for the source/status enum tuples, shared with the pgEnum)
    projects/                getProjectsPage (server-only, paginated, open read) + searchStaff/searchCompanies (type-ahead, projects.edit-gated) + createProject — writes gated projects.edit (+.schema.ts, pure)
    feedback/                createFeedback (+ .schema) + authorizeFeedback (canGiveFeedback + authorizeFeedbackCreate hook — giving open to active staff, no capability) + getFeedbackAboutMe/getFeedbackIGave/getFeedbackDetail (server-only reads, privacy enforced by projection) + searchStaffForFeedback (recipient picker) — see [domains/performance.md](./domains/performance.md)
    timesheets/              getTimesheet + getSelectableProjects (server-only reads, self-scoped / open) + saveTimesheet/submitTimesheet/reopenTimesheet (mutations) + canEditTimesheet (canEditTimesheet(user, {staffId,weekStartDate}) → boolean + authorizeTimesheetEdit hook: own-in-window always, else timesheets.edit) (+ saveTimesheet.schema.ts / timesheetWeek.schema.ts) — see [domains/timesheets.md](./domains/timesheets.md), [ADR 0025](./decisions/0025-timesheet-weekly-model-and-edit-window.md)
    shared/                  entitySearch.ts — shared searchStaffByName/searchCompaniesByName query bodies (server-only) reused by BOTH crm/ and projects/ search actions (each wraps with its own permission gate)
  components/                React components; ui/ = vendored shadcn primitives,
                             form/ = shared form-dialog + form-field + enum-select (EnumSelect, extracted from add-opportunity-dialog for reuse),
                             app-shell/ + auth/ + brand/ = the UI shell, admin/ = shared csv-import + editable-table + table-filters + data-table + staff-import + pto-import + bulk-edit-roles + manage-users + promote-self-button UI,
                             staff/ = shared ProfileView (backs /profile + /staff/[id]) + directory/cards + edit dialogs (links, client-intro, resume) + history sheet,
                             crm/ = add-{company,contact,opportunity}-dialog + company-combobox + entity-multi-combobox + entity-combobox (single-select sibling, used by projects) + create-{company,contact}-inline-dialog + {companies,contacts,opportunities}-table + opportunity-display + pagination-controls,
                             projects/ = add-project-dialog (useFieldArray roles repeater) + projects-table,
                             feedback/ = feedback-form (give-feedback) + feedback-about-me + feedback-given-table + feedback-detail-fields (detail page),
                             timesheets/ = timesheet-week (client weekly grid: week nav, project/bucket row picker, per-day totals + cap warning, Save/Submit/Reopen),
                             plus top-level shared cells empty-cell.tsx + external-link.tsx
  hooks/                     useZodForm (RHF + zodResolver wrapper), useDebouncedValue (debounce, used by company-combobox), useMobile
  lib/
    action.ts                publicActionClient + secureActionClient (the core); metadata-driven gates: role + permission + authorize (ActionAuthorize hook), all enforced before the body
    auth.ts auth-client.ts   better-auth server + client (admin plugin wired with ac/roles); getCurrentUser/checkAuth
    permissions.ts           RBAC single source of truth: statement, roles, matrix, userHasPermission/requirePermission (+ .test.ts asserts the matrix)
    staff.ts                 getCurrentStaff(user) — resolves user→staff, email auto-link, StaffAccessStatus gate
    errors.ts                UserSafeActionError (user-safe error channel)
    logger.ts                structured logging used by the action layer
    utils.ts                 cn()
    constants.ts             APP_NAME / APP_DESCRIPTION (shared app strings)
    format.ts                humanizeEnum() + formatDate() + initialsFor() + formatTimestamp() — display helpers (timezone-safe date/time formatting)
    like.ts                  escapeLike() — escape LIKE/ILIKE metacharacters so user input matches literally
    line-of-business.ts      shared LINE_OF_BUSINESS tuple + labels (pure, client-importable) — single source for the lineOfBusinessEnum pgEnum, the projects zod schema, and the form
    currency.ts              CURRENCY tuple + labels + formatMoney (pure) — single source for the currency pgEnum, comp import schema, and display ([ADR 0020](./decisions/0020-compensation-effective-dated-import-only.md))
    skills.ts                the hardcoded skills catalogue (SKILL_CATEGORIES/ALL_SKILLS + PROFICIENCY_LEVELS, client-safe) — single source for the picker, the zod schema, and staff.skills ([ADR 0018](./decisions/0018-skills-inline-jsonb-catalogue.md))
    feedback-rating.ts       FEEDBACK_RATINGS tuple + labels/descriptions (pure) — single source for the feedback_rating pgEnum, the zod schema, and the rating radio ([ADR 0023](./decisions/0023-feedback-privacy-tiers.md))
    timesheet-category.ts    TIMESHEET_CATEGORY tuple + labels (pure) — single source for the time_entry_category pgEnum, the save zod schema, and the grid's bucket labels (PTO independent of staff_pto) ([ADR 0025](./decisions/0025-timesheet-weekly-model-and-edit-window.md))
    timesheet-week.ts        week math (pure, client-importable): getWeekStart/addWeeks/getWeekDays/currentWeekStart/weeksBetween/isWithinEditWindow — weeks keyed by ISO-Monday "YYYY-MM-DD", no date library, no UTC drift
    opportunity-pipeline.ts  OPPORTUNITY_GROUPS + status-group derivation + fractional-ordering helpers (pure; +.test.ts) — the kanban's two-level grouping lives in code, not the DB ([ADR 0021](./decisions/0021-opportunity-pipeline-groups-and-fractional-ordering.md))
    employment.ts            the billability invariants (isEmploymentInvariantSatisfied + normalizeEmploymentFacts, pure) — single source shared by staff-import, the bulk-edit schema/form (mirrors line-of-business.ts)
    id-schema.ts             shared reusable id/foreign-key zod field
    pagination.ts            shared server-side pagination primitives (page size, offset/limit + count, {rows,total,page,pageSize,pageCount} envelope) — used by all CRM list reads
    search.ts                shared type-ahead search primitives (query-limit schema etc.) — used by search{Companies,Contacts,Staff}
    url-schema.ts            shared optional-URL zod field (blank→null; bare host → https:// normalised)
    text-schema.ts           shared optional free-text zod field (blank/whitespace→null, else trimmed)
    collections.ts           fold pre-sorted rows into a Map keeping the FIRST per key (staff picks latest-employment-per-staff)
    admin.ts                 isLocalhost()/assertLocalhost() — the admin-area security boundary (host header)
    csv-import/              shared CSV plumbing: parse.ts (key normalise, date parse, duplicate tracking), types.ts, index.ts — consumed by staff-import/ + pto-import/ + the import UIs
    staff-import/            CSV staff import: transform.ts (pure), plan.ts (server diff), types.ts (shared zod) — builds on csv-import/
    pto-import/              CSV PTO import (same shape as staff-import): transform.ts / plan.ts / types.ts — builds on csv-import/
    db/
      db.ts                  hot-reload-safe Drizzle singleton
      schema.ts              barrel: re-exports auth-schema + staff-schema + crm-schema + projects-schema + performance-schema + timesheets-schema (one import for the whole schema)
      staff-schema.ts        staff / staff_employment / staff_pto + domain enums (lineOfBusinessEnum built from src/lib/line-of-business.ts)
      crm-schema.ts          companies / contacts / opportunities + 4 opportunity junction tables (CRM slice)
      projects-schema.ts     projects / project_delivery_managers / project_roles (Projects slice; project_roles = first cut of Allocation)
      performance-schema.ts  feedback (peer feedback; from/to staff FKs, feedback_rating enum — first Performance slice)
      timesheets-schema.ts   timesheets / time_entries (Timesheets slice; timesheet_status + time_entry_category enums; per-day actuals, project-XOR-category CHECK)
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

`src/app/admin/**` is a **local-only tooling surface** for data seeding/maintenance: two CSV importers — staff (`upload-staff`) and PTO (`upload-pto`) — plus a **bulk employment editor** (`bulk-edit-roles`) that maintains existing `staff_employment` rows (in-place correction or new effective-dated rows; the only in-app way to edit employment facts — see [ADR 0007](./decisions/0007-staff-employment-effective-dating.md)). Those three are staff-profiles tooling (see [staff-profiles.md](./domains/staff-profiles.md)). A fourth, **Manage Users** (`manage-users`), edits application users' RBAC role + ban status — see [permissions.md](./domains/permissions.md). A **Promote self to admin** button (`promote-self-button.tsx` → `promoteSelfToAdmin`) breaks the chicken-and-egg of that tool: it's the **one** place a role is set by a direct column write rather than the Better Auth admin API (whose `setRole` requires the caller to already be an admin), gated by `secureActionClient` + `assertLocalhost` so it can only ever promote the current user, locally. Two deliberate choices:

- **Outside the `(app)` route group, on purpose.** The `(app)` layout redirects users without an active staff record to `/profile-setup`; the staff-upload tool is exactly what *creates* those records (chicken-and-egg). So admin must NOT require auth/staff — it requires only that the request is local.
- **The security boundary is the host, not auth.** `src/lib/admin.ts` exports `isLocalhost()` / `assertLocalhost()`, which check the request `host` header against loopback hosts (`localhost`, `127.0.0.1`, `::1`). `admin/layout.tsx` calls `isLocalhost()` and `notFound()`s the whole segment for non-local requests; **every admin action calls `assertLocalhost()` itself** (no middleware does it for them). The importers + bulk-editor use `publicActionClient` (local seeding must run before any staff/admin exists). The one exception is `commitUserChanges` (manage-users): it adds `secureActionClient` + `metadata({ role: "admin" })` because it mutates through the Better Auth admin API, whose endpoints require the *caller* to be an admin — so that tool also needs a signed-in admin (bootstrapping caveat in [permissions.md](./domains/permissions.md)). Enforced server-side only — never trusted from the client. Reachable by direct URL; there's no sidebar nav entry. See [ADR 0008](./decisions/0008-localhost-only-admin-area.md).

## Env

`src/env.ts` validates `process.env` once at import with zod. It is **server-only by convention** but deliberately omits `import "server-only"` — drizzle-kit and the better-auth CLI run in plain Node and import the module chain (db → env), so the marker would break them. Client code must read `NEXT_PUBLIC_*` directly. Optional vars use a preprocess that coerces **blank entries (`FOO=`) to `undefined`** rather than failing on a zero-length string. Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`. Optional: `BETTER_AUTH_URL`, and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` — both must be set for sign-in to work, since Google is now the only auth method. Real Google OAuth creds and a Neon-hosted Postgres `DATABASE_URL` are configured in `.env`; that DB is migrated and up to date.

## Auth

better-auth with the **admin** plugin — wired with the RBAC access controller and roles from `src/lib/permissions.ts` (`admin({ ac, roles, adminRoles: ["admin"], defaultRole: "user" })`; see [domains/permissions.md](./domains/permissions.md), [ADR 0014](./decisions/0014-rbac-better-auth-access-control.md)); **Google-only sign-in** — `emailAndPassword` is disabled and Google is the sole social provider (see [decisions/0006](./decisions/0006-google-only-auth-and-layout-gating.md)). Server instance (`src/lib/auth.ts`) uses the Drizzle adapter over our singleton `db`; **the better-auth tables (`user`, `session`, `account`, `verification`) live in our own schema/migrations** (`auth-schema.ts`), regenerated via `bun run auth:generate`. Two helpers gate the app:

- `getCurrentUser()` — reads the session, returns the user or `null`.
- `checkAuth(role)` — throws a `UserSafeActionError` if unauthenticated or under-privileged; **admins satisfy any role requirement** (admin override). Used by the secure action middleware.

`nextCookies()` must be the last plugin so Set-Cookie flushes from server actions. The whole auth API is mounted by one catch-all route (`src/app/api/auth/[...all]/route.ts`).

**Auth UI is built.** `/login` (in the `(auth)` group) shows a single "Continue with Google" button; the `(app)` route-group **layout** (`src/app/(app)/layout.tsx`, a Server Component) gates every authenticated page by calling `getCurrentUser()` and `redirect("/login")` when there's no session — **route protection is in the layout, not middleware** (consistent with the no-middleware posture). Sign-in via `authClient.signIn.social({ provider: "google" })`, sign-out via `authClient.signOut()`. See [ui.md](./ui.md) for the screens and [decisions/0006](./decisions/0006-google-only-auth-and-layout-gating.md) for the why. Layout gating guards navigation only — server actions still authorize independently (see Authorization below).

**Beyond a session, the app gates on a usable staff record.** After the session check, the `(app)` layout calls `getCurrentStaff(user)` (`src/lib/staff.ts`), which resolves the user to a `staff` row and returns a discriminated `StaffAccessStatus` (`ok` | `incomplete` | `not_setup`). Only `ok` (active staff record with ≥1 employment row) enters the app; the others redirect to the single `/profile-setup` block screen (`(onboarding)` route group, no group layout — the page self-gates). On first login it auto-links the email-synced staff row by writing `staff.userId` (guarded on `userId IS NULL`). See [flows.md](./flows.md) (auth flow), the [staff-profiles domain doc](./domains/staff-profiles.md), and [decisions/0006](./decisions/0006-google-only-auth-and-layout-gating.md).

## Data access — the actions layer is the only door to the DB

`db` is imported **only from `src/actions/**`**. Pages, layouts, and components — **including SSR Server Components** — never import `db` or query Drizzle directly; they call into the actions layer. This keeps every read and write in one place to authorize, project columns, and apply domain rules. See [ADR 0010](./decisions/0010-actions-layer-owns-db-access.md), `.claude/rules/server-actions.md`, `.claude/rules/database.md`.

- **Mutations** → next-safe-action actions (the action layer below / [ADR 0004](./decisions/0004-action-layer.md)).
- **Reads (incl. SSR)** → a plain **server-only** async function in the domain folder: `import "server-only"`, named `get<Thing>.ts` (e.g. `src/actions/staff/getStaffProfile.ts`, which `/staff/[id]` `await`s). **Not** a `'use server'` action — that would force the `{ data, serverError }` envelope and re-run session checks, awkward for SSR. It exports its return type. Personal reads resolve the user inside and filter by ownership (inherently scoped); **cross-person reads** (the staff directory and `/staff/[id]`) take an id and are **not** ownership-scoped — the `(app)` layout gate is their boundary, with capability checks layered where data is sensitive (e.g. `getStaffPto` requires `pto.review` for non-owners — see Authorization, [domains/permissions.md](./domains/permissions.md)).

**Legitimate `db` importers outside `actions/`:** framework wiring (the Better Auth Drizzle adapter in `src/lib/auth.ts`) and pure compute helpers an action delegates to (`src/lib/*-import/plan.ts`, reached only through an action). **One known straggler:** `getCurrentStaff` (`src/lib/staff.ts`) is called straight from the `(app)` layout — fold it into the actions layer when next touched.

## Authorization — RBAC declared in action metadata

Most data is sensitive (rates, salaries, reviews), so authz is first-class. There's
a full **role-based access-control model** ([ADR 0014](./decisions/0014-rbac-better-auth-access-control.md),
[domains/permissions.md](./domains/permissions.md)) on Better Auth's native access
control, with `src/lib/permissions.ts` as the single source of truth (the statement,
the roles, the role→permission matrix, and the `userHasPermission` / `requirePermission`
helpers). Authorization is **declared in action metadata, never hand-written in
action bodies**. There is **one** `secureActionClient`; its middleware runs all three
declarative forms, in order, *before* the body (see `.claude/rules/server-actions.md`
and `.claude/rules/permissions.md`):

1. **Coarse role** — `metadata.role` → `checkAuth(role)` (admin-override).
2. **Static capability** — `metadata.permission` (a `PermissionCheck`) →
   `requirePermission`. Use for capabilities that don't depend on the input.
3. **Input-dependent / ownership** — `metadata.authorize`, an **`ActionAuthorize`**
   hook (`{ user, clientInput } => void | Promise<void>`) that reads the raw
   `clientInput` (the target id, cross-field rules) and throws `UserSafeActionError`
   to deny. This is a **generic, reusable mechanism**, not staff-specific — any
   domain supplies its own hook. Mandatory wherever a target id could be acted on
   across users; a route-level gate alone is not enough.

`metadata.authorize` replaced the earlier "compose a bespoke client" approach — the
hook lives on the single `secureActionClient`, so there's no per-feature client to
build. (Reads are plain server-only functions, not actions — they call the helpers
inline, e.g. `getStaffPto` requiring `pto.review` for non-owners.)

Helpers **fail closed** (unknown/null role → least privilege). The matrix is the
contract — asserted by `src/lib/permissions.test.ts` (runs in `bun run check`) and
audited by `/audit-rbac`. **Never weaken or bypass a permission check; flag any gap
as a vulnerability** (`.claude/rules/permissions.md`).

The earlier open-staff-edit gap is **now closed** ([ADR 0014](./decisions/0014-rbac-better-auth-access-control.md)):
staff link/intro edits declare `metadata({ authorize: authorizeStaffEdit })`
(`src/actions/staff/canEditStaff.ts`), which gates via `canEditStaff` (own → always;
other → `staff.edit`), and `getStaffPto` requires `pto.review` to read another
person's PTO.

## Running the DB

The DB is not auto-provisioned. Dev uses a **remote Postgres** (e.g. Neon) — there is no local DB. Set `DATABASE_URL` (get it from the team), then `bun run db:migrate` to apply migrations. Iterate with `db:generate` → `db:migrate` (or `db:push` for quick dev), browse with `db:studio`. See `.claude/rules/database.md`.

## Cross-cutting concerns

- **Authorization** — see the metadata-driven RBAC model above and [domains/permissions.md](./domains/permissions.md). Role-based, capability-gated, not an afterthought.
- **Time** — allocations and timesheets are inherently time-ranged; date/timezone handling needs a deliberate approach.
- **Auditing** — financial and performance data likely need change history.

## Open questions

- Single-tenant (one consultancy) or multi-tenant? Assumed **single-tenant internal** until told otherwise.
- Billing: does this platform invoice, or just produce the billing basis for another system?
- Integrations: HR, accounting, calendars?
