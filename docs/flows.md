# Key flows (cross-domain)

**Status: proposed.** The end-to-end paths the platform must support. Each crosses multiple domains, which is why they live here rather than in a single domain doc.

## The core lifecycle: sell → staff → deliver → bill → review

1. **Sell (CRM).** An Opportunity progresses through the pipeline for a Client. When *won*, it produces a Project.
2. **Staff (Allocations).** Managers allocate People to the Project over a date range, using StaffProfile skills and current availability/utilization to choose who.
3. **Deliver + log (Timesheets).** Allocated People log TimeEntries against the Project. Entries roll into Timesheets for approval.
4. **Bill (Timesheets → finance).** Approved billable hours × charge rate become the billing basis. Margin = (charge − cost) × hours.
5. **Review (Performance).** During a ReviewCycle, a Person's project work and utilization inform their PerformanceReview and Goals.

## Supporting flows

- **Capacity planning** — compare each Person's allocations (plan) against availability to find who's over/under-allocated before staffing new work.
- **Forecast vs. actuals** — compare allocated hours against logged TimeEntries to track delivery health and re-forecast.
- **Timesheet approval** — submit → manager review → approve/reject → locked for billing.

## Auth flow (Google sign-in → session → app access)

How a user gets into the authenticated app. Auth is **Google-only** (see [architecture.md](./architecture.md), [decisions/0006](./decisions/0006-google-only-auth-and-layout-gating.md)).

1. **Hit a protected page.** Any `(app)/**` route runs `(app)/layout.tsx` (Server Component) → `getCurrentUser()`. No session → `redirect("/login")`.
2. **Sign in.** `/login` (already-signed-in users are redirected to `/`) shows one button → `authClient.signIn.social({ provider: "google", callbackURL: "/" })`. The browser leaves for Google's consent screen (`prompt: "select_account"`).
3. **Callback.** Google redirects back to the better-auth catch-all (`/api/auth/...`), which exchanges the code, upserts the `user`/`account`/`session` rows (in our own schema), and sets the session cookie.
4. **Staff-record gate.** Having a session is necessary but not sufficient — the `(app)` layout then calls `getCurrentStaff(user)` (`src/lib/staff.ts`), which resolves the user to a `staff` record and returns a discriminated `StaffAccessStatus`:
   - **`ok`** — active `staff` row (`isActive = true`) with **≥1 `staff_employment` row** → render `<AppShell>`, enter the app.
   - **`not_setup`** — no active staff row matched → `redirect("/profile-setup")`. (Terminated staff are `isActive = false` and land here; a rehire is a new row, see [ADR 0007](./decisions/0007-staff-employment-effective-dating.md).)
   - **`incomplete`** — active staff row but **zero** employment rows → `redirect("/profile-setup")`.
   - **Matching + auto-link:** prefer the row already linked by `staff.userId = user.id`; else fall back to the active row with `staff.email = user.email` and **link it** by writing `staff.userId` (guarded on `userId IS NULL`, so it fires at most once per person and concurrent logins are harmless). Staff are synced by email before anyone signs in, which is why `userId` starts null.
5. **Land in the app.** Redirect to `/`; the `(app)` layout finds a session **and** an `ok` staff status, renders `<AppShell>`. The session user (name/email/image) flows from the server layout into the shell.
6. **Blocked screen.** `not_setup`/`incomplete` users land on the single `/profile-setup` page (`(onboarding)` route group, no group layout) — one full-screen, login-styled notice that swaps its title/body for the two cases ("Your profile isn't set up yet" / "Your profile is incomplete", contact Andrew) with only a sign-out button. The page **self-gates** like `/login`: it re-runs `getCurrentStaff`, redirects unauthenticated users to `/login`, and bounces `ok` users back to `/` so a fixed-up profile is never stuck on the block screen.
7. **Sign out.** `authClient.signOut()` clears the session, then `router.replace("/login")` (`src/components/auth/sign-out-button.tsx`).

Note: this flow guards *navigation*. Mutations still authorize independently via the action layer (below) — the layout redirect is not an authz boundary for server actions.

## Staff import flow (localhost-only admin → staff records)

How people first get into the system. It runs in the **local-only admin area** (`/admin/upload-staff`), outside `(app)` because it creates the very staff records the app gates on (see [architecture.md](./architecture.md) → Admin area, [ADR 0008](./decisions/0008-localhost-only-admin-area.md)). Full mapping + derivation rules live in [domains/staff-profiles.md](./domains/staff-profiles.md).

1. **Gate.** `admin/layout.tsx` runs `isLocalhost()` (host header); non-loopback requests `notFound()`. No auth/staff required.
2. **Pick + parse (client).** `staff-import.tsx` reads a Rippling CSV export, parses it client-side with PapaParse, then runs the pure `transformRows` (`src/lib/staff-import/transform.ts`): column mapping → derivation (line of business, role, employment type, billability) → either a normalized row or a **skipped** row (missing required field, unparseable date, or unmappable line of business).
3. **Preview.** Calls the `previewStaffImport` action (`publicActionClient` + `assertLocalhost()`), which runs `computeImportPlan` to diff incoming rows against the DB **by `ripplingId`** into creates / updates (with changed-field marking) — read-only. The UI renders three TanStack tables: New / Updates / Skipped.
4. **Confirm → commit.** `commitStaffImport` **recomputes the plan server-side** (the client diff is never trusted) and applies it in one transaction: creates → `staff` + initial `staffEmployment` (effective on join); updates → `staff` identity in place + a NEW `staffEmployment` row (effective today) **only when an employment fact changed** (ADR 0007). Returns counts; `revalidatePath("/")`.

> Edge case: duplicate `ripplingId`s within one CSV aren't de-duped and would fail the commit transaction on the unique constraint — a clean Rippling export shouldn't contain them.

## PTO import flow (localhost-only admin → leave records)

A second admin importer at `/admin/upload-pto`, same shape and same localhost gate as the staff import, writing `staff_pto`. Full mapping + derivation rules in [domains/staff-profiles.md](./domains/staff-profiles.md); the *why* behind cancel-as-delete in [ADR 0009](./decisions/0009-pto-import-cancel-as-delete.md). The two structural differences from the staff flow:

1. **Two-level match.** Each row resolves a staff member by `Employee - ID` (`staff.ripplingId`), then matches an existing PTO record by `Leave request ID` (`staffPto.ripplingId`).
2. **Rows can delete, not just upsert.** `Leave request status` drives an `action` discriminator: `APPROVED`/`Pending` → upsert (with `isPending` set accordingly); `REJECTED`/`CANCELED` → delete the record if it exists.

Steps: gate (host) → parse + `transformRows` (client, into upsert/delete rows or skipped) → `previewPtoImport` runs `computePtoImportPlan` (read-only diff into creates / updates / deletes / **unresolved** / unchanged / ignoredCancellations) → preview tables (New PTO / Updates / To delete / Unresolved / Skipped) → `commitPtoImport` recomputes the plan server-side and applies it in one transaction (insert creates, update by id, delete by leave-request id), then `revalidatePath("/")`.

> Note the `unresolved` bucket: an upsert whose `Employee - ID` matches no staff can't be inserted (no FK target) and is surfaced for review — so **run the staff import first**. A delete for leave that was never imported is a harmless no-op (`ignoredCancellations`).

## Browse-staff flow (directory → per-person profile)

How a signed-in user finds and views colleagues. All reads go through the actions layer (ADR 0010); none are ownership-scoped — the `(app)` layout's session+staff gate is the only access boundary, and editing is open to any signed-in user for now ([ADR 0012](./decisions/0012-open-staff-edit-pending-rbac.md)).

1. **Directory (`/staff`).** The page `await`s `getStaffDirectory()` once (server) — two queries (all staff + the whole `staff_employment` table, reduced to latest-per-staff in JS; no N+1) plus `staffDirectoryFilterOptions`. The `StaffDirectory` client component does **all** search (name) and filtering (line of business / role / employment type) over that single fetch, with an **"active only" toggle defaulting ON** that hides inactive staff (fetched but not shown until toggled off). Card grid of `staff-card.tsx`.
2. **Open a person (`/staff/[id]`).** `Promise.all` of `getStaffProfile(id)` / `getStaffHistory(id)` / `getStaffPto(id)` / `getStaffAvatar(id)`. Unknown id → `notFound()`. `generateMetadata` titles the tab with the person's name (shares the `React.cache`d `getStaffProfile` query with the body). Renders the shared `ProfileView` — the same component that backs `/profile` — so self and other profiles look identical; the edit dialogs receive the target `staffId`.
3. **Edit (any signed-in user, temporary).** `updateStaffLinks` / `updateStaffClientIntro` write by `staffId` and revalidate `/profile` + `/staff/${staffId}`. No row-level ownership check today — see [ADR 0012](./decisions/0012-open-staff-edit-pending-rbac.md).

> The self page `/profile` is the same flow with the id resolved from the session via `getCurrentStaffId()` (the `getMy*` wrappers delegate to the `getStaff*` cores).

## The technical request flow (every mutation)

This is how *any* form-driven write moves through the stack. It is the concrete realization of the stack in [architecture.md](./architecture.md). (The former `StaffProfileForm` → `updateStaffProfile` demo slice has been deleted; no domain write exists in code yet, so the steps below describe the *intended* pattern.)

1. **Form (client).** A react-hook-form form bound to a server action — either via `useHookFormAction` (tight binding, form shape == action input) or `useAction` + `useForm`/`useZodForm` (loose). The Zod schema lives in a `*.schema.ts` file so both the form resolver and the action can import it without crossing the `'use server'` boundary. See `.claude/rules/forms.md`.
2. **Submit → action middleware** (`src/lib/action.ts`), in order:
   - **logging** — `publicActionClient` logs `action_start` with a requestId + clientInput, times the call, logs `action_end`.
   - **auth** — `secureActionClient` calls `checkAuth(metadata.role ?? "user")`, injecting `ctx.user` (admins override role checks).
   - **inputSchema validation** — `.inputSchema(zod)` parses `parsedInput`; failures return field errors, not a serverError.
3. **Action body.** Row-level authz (ownership check), then Drizzle reads/writes via the singleton `db`.
4. **revalidatePath / revalidateTag** after the mutation so server-rendered data refreshes.
5. **Result → client.** Success → `action.hasSucceeded` / `onSuccess`. Failure → a thrown `UserSafeActionError` surfaces its message as **`action.result.serverError`** (and `error.serverError` in `onError`); any other throw is collapsed to a generic message so internals never leak (see [decisions/0004](./decisions/0004-action-layer.md)).

> When a flow changes, the librarian should update both this file and the affected domain docs.
