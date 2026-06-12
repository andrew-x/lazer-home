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
4. **Land in the app.** Redirect to `/`; the `(app)` layout now finds a session and renders `<AppShell>`. The session user (name/email/image) flows from the server layout into the shell.
5. **Sign out.** `authClient.signOut()` clears the session, then `router.replace("/login")` (`src/components/auth/sign-out-button.tsx`).

Note: this flow guards *navigation*. Mutations still authorize independently via the action layer (below) — the layout redirect is not an authz boundary for server actions.

## The technical request flow (every mutation)

This is how *any* form-driven write moves through the stack. It is the concrete realization of the stack in [architecture.md](./architecture.md); the example slice is `StaffProfileForm` → `updateStaffProfile`.

1. **Form (client).** A react-hook-form form bound to a server action — either via `useHookFormAction` (tight binding, form shape == action input) or `useAction` + `useForm`/`useZodForm` (loose). The Zod schema lives in a `*.schema.ts` file so both the form resolver and the action can import it without crossing the `'use server'` boundary. See `.claude/rules/forms.md`.
2. **Submit → action middleware** (`src/lib/action.ts`), in order:
   - **logging** — `publicActionClient` logs `action_start` with a requestId + clientInput, times the call, logs `action_end`.
   - **auth** — `secureActionClient` calls `checkAuth(metadata.role ?? "user")`, injecting `ctx.user` (admins override role checks).
   - **inputSchema validation** — `.inputSchema(zod)` parses `parsedInput`; failures return field errors, not a serverError.
3. **Action body.** Row-level authz (ownership check), then Drizzle reads/writes via the singleton `db`.
4. **revalidatePath / revalidateTag** after the mutation so server-rendered data refreshes.
5. **Result → client.** Success → `action.hasSucceeded` / `onSuccess`. Failure → a thrown `UserSafeActionError` surfaces its message as **`action.result.serverError`** (and `error.serverError` in `onError`); any other throw is collapsed to a generic message so internals never leak (see [decisions/0004](./decisions/0004-action-layer.md)).

> When a flow changes, the librarian should update both this file and the affected domain docs.
