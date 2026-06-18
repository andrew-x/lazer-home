# Frontend / UI

**Status: built.** The authenticated UI shell, auth screens, and error/404/loading conventions exist. Domain pages are still placeholders. Path-scoped working rules are in `.claude/rules/ui.md` (loads when you touch `src/components/**` or `src/app/**`) — read it before writing UI code; this doc is the architectural *why*.

## Component library

shadcn on **Base UI** primitives (`base-nova` preset, **Tabler icons**, Geist font). Config: `components.json` (`style: "base-nova"`, `baseColor: "neutral"`, RSC on, aliases `@/components`, `@/lib`, `@/components/ui`, `@/hooks`).

- **Icons: `@tabler/icons-react`** (`Icon*` components, e.g. `IconHome`, `IconSettings`). Lucide was **removed** (`lucide-react` uninstalled) — all app + vendored `src/components/ui/**` icons use Tabler, and `nav.ts` types icons via Tabler's `Icon` type. Don't add other icon libraries.
- **Add components, don't hand-write them:** `bunx --bun shadcn@latest add <name>` (e.g. `table`, `dialog`, `tabs`, `badge`). Re-add with `--overwrite` to update. **Gotcha:** the shadcn registry emits Lucide imports — after re-adding any `ui/**` component, re-swap its icons to Tabler.
  - **Exception — `dialog.tsx` and `textarea.tsx` were vendored by hand**, not via the CLI. The `shadcn add dialog` run wanted to **overwrite our hand-edited `button.tsx`** (which carries the deliberate `loading` prop) and pulls Lucide, so `dialog.tsx` was instead written to mirror the existing `sheet.tsx`: a centered modal on `@base-ui/react/dialog` with a Tabler `IconX` close. Treat both as vendored primitives all the same (don't hand-edit beyond the icon swap). The `<Dialog>`/`<DialogTrigger render={…}>`/`DialogContent`/`DialogHeader`/`DialogFooter`/`DialogClose` API matches the sheet's.
- **Vendored primitives** live in `src/components/ui/**` and are treated as generated code: don't hand-edit, and Biome skips linting them via an `overrides` block in `biome.json` (turns off a11y/exhaustive-deps/document-cookie rules that the registry code trips). Current set also includes `select`, `switch`, `toggle`/`toggle-group`, `popover`, `calendar`, and a composed `date-picker`. The **`date-picker`** (`src/components/ui/date-picker.tsx`) is our own composition of the vendored `popover` + `calendar` (built on `react-day-picker` + `date-fns`, both added for it) over the project's Base UI primitives, with Lucide icons swapped to Tabler; it takes/returns a `"YYYY-MM-DD"` string (timezone-agnostic, per `.claude/rules/database.md`). Used by the bulk-edit save bar. **Exception — `Button`'s `loading` prop:** `button.tsx` carries a deliberate hand-edit. `<Button loading>` renders a leading `IconLoader2` spinner (inherits variant color/size), auto-disables (`disabled || loading`), and sets `aria-busy` — the canonical way to satisfy the forms rule's "drive button loading state from `isPending`/`isExecuting`" (used at the auth buttons and `staff-import.tsx`'s confirm). **Gotcha:** re-adding Button via `shadcn --overwrite` drops this prop; re-apply it after any overwrite.
- **Polymorphism uses a `render` prop, NOT Radix's `asChild`.** Base UI is not Radix — your training data is likely wrong here. To render a button as a link: `<Button render={<Link href="/x" />}>` (see `not-found.tsx`).

## Theming & tokens

- Tokens are oklch CSS variables in `src/app/globals.css` (`:root`), surfaced to Tailwind v4 via `@theme inline`. Imports: `tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css`.
- `--font-heading` maps to Geist sans.
- **Light mode only.** A `.dark` block and the `dark` custom variant exist (carried in from the registry) but are **unused** — there is no theme toggle. Don't wire one up without a decision.
- Use **semantic classes** (`bg-primary`, `text-muted-foreground`, `bg-sidebar-accent`, `border`), never raw hex or `indigo-600`. Conditional classes via `cn()` from `@/lib/utils`.

### Design language (current source of truth)

A deliberate, editorial look that **avoids the generic AI-app aesthetic** (rounded + shadowed + accent-heavy). This refines the theme described in [decisions/0005](./decisions/0005-ui-stack.md) — that ADR still holds for the stack and the indigo-light-mode choice, but the specifics below supersede its "indigo accent" framing.

- **Sharp corners.** `--radius` is `0.25rem` (4px); all the `--radius-*` steps derive from it. Don't bump radii per-component.
- **Flat surfaces.** No elevation shadows — a utility-layer rule in `globals.css` neutralizes every `shadow-*` to `box-shadow: none`. Hairline `border`s define edges; use `border` for separation, never a shadow.
- **Indigo, sparingly.** The UI is mostly **monochrome neutral grays**. The `--accent`/`--accent-foreground` and `--sidebar-accent`/`--sidebar-accent-foreground` tokens are neutral (not indigo). Indigo lives only in `--primary` and `--ring`, so it surfaces only on primary buttons, focus rings, links, and the active nav item's icon (`app-sidebar.tsx` adds `text-primary` to the active icon). Don't tint hovers/cards/backgrounds indigo — the accent reads as intentional precisely because it's rare.
- **Global `cursor-pointer`.** A base-layer rule gives `button`s and ARIA-interactive roles (`menuitem`, `option`, `switch`, `tab`, `checkbox`, `radio`, …) a pointer cursor — Base UI / shadcn omit it by default. Don't add `cursor-pointer` per component.
- **Minimal auth surfaces.** `(auth)/login/page.tsx` is a single centered column — logo mark + product name + one Google button + "Lazer staff only" — no card, no gradient. Keep auth/marketing screens uncluttered.

### Brand (intentionally off-accent)

The brand mark is `public/icon.svg` — **magenta** (`#FF00C5`) — exposed via `<LogoMark>` / `<Logo>` in `src/components/brand/logo.tsx`. The product name is `APP_NAME` ("Lazer Home") in `src/lib/constants.ts`. The magenta mark against the indigo UI accent is **intentional** — the logo is the brand, the indigo is the product chrome; don't "fix" the mismatch.

## Routing & auth gating

Route groups split public from authenticated, and **route protection lives in a layout, not middleware** — consistent with the project's deliberate no-middleware stance (see ADR-0006).

- `src/app/(app)/**` — authenticated pages. `(app)/layout.tsx` is an async Server Component that calls `getCurrentUser()` and `redirect("/login")` when there's no session, **then** `getCurrentStaff(user)` and redirects any non-`ok` status to the single `/profile-setup` route (status is `ok` = active staff record with employment — see [flows.md](./flows.md)). Every page under `(app)` is gated by this two-step check.
- `src/app/(onboarding)/**` — the post-login **block** screen for authenticated users who can't enter the app yet: a single `profile-setup/page.tsx` that resolves `getCurrentStaff` itself and shows different title/body for the `incomplete` vs `not_setup` cases (same screen). There is **no group `layout.tsx`** — the page self-gates like `/login`: it redirects unauthenticated users to `/login` and bounces `ok` users back to `/` so a fixed-up profile is never stuck here. The screen uses `OnboardingNotice` (`src/components/auth/onboarding-notice.tsx`) — a login-styled full-screen notice (logo + title + message + `SignOutButton`).
- `src/app/(auth)/**` — public pages (currently only `/login`, which redirects to `/` if already signed in).
- The old default `src/app/page.tsx` was deleted; the home dashboard is now `(app)/page.tsx` served at `/`.

Pages today: `/login` (landing + Google button), `/` (home dashboard with placeholder stat cards), `/staff` ("Browse staff" — searchable/filterable directory of everyone) and `/staff/[id]` (a person's profile), `/profile` ("My profile" — your own staff profile, same presentation as `/staff/[id]`), `/settings` (account info synced from Google + sign out), `/profile-setup` (the single onboarding block screen, two messages). The Staff nav item (`IconUsers`) is in `NAV_ITEMS`.

### Profile pages — `ProfileView` (shared by `/profile` and `/staff/[id]`)

`ProfileView` (`src/components/staff/profile-view.tsx`) is the single presentation for a staff profile — name, avatar, employment badges, links, client intro, résumé, history drawer, PTO. **Both** `/profile` (own record) and `/staff/[id]` (anyone) render it; they differ only in which `staffId` they resolve and pass in. The pages don't touch `db` — they `await` actions-layer **reads** (server-only async functions, not `'use server'` actions; see [ADR 0010](./decisions/0010-actions-layer-owns-db-access.md)):

- **`/staff/[id]`** (`(app)/staff/[id]/page.tsx`) `Promise.all`s `getStaffProfile(id)` / `getStaffHistory(id)` / `getStaffPto(id)` / `getStaffAvatar(id)`, `notFound()`s on an unknown id, and uses `generateMetadata` to title the tab with the person's name (shares the `React.cache`d `getStaffProfile` query). **Not** ownership-scoped — the `(app)` gate is the boundary (ADR 0012).
- **`/profile`** (`(app)/profile/page.tsx`) is the same, with the id resolved from the session (`getCurrentStaffId()`); the `getMy*` reads are thin wrappers over the `getStaff*` cores.

`getStaffProfile` returns the profile fields (incl. `resume`/`resumeUpdatedAt`) plus the **latest** `staffEmployment` row via the [ADR 0007](./decisions/0007-staff-employment-effective-dating.md) ordering. Enums display via `humanizeEnum()`, calendar dates via the timezone-safe `formatDate()`, instant `timestamp`s (e.g. `resumeUpdatedAt`) via `formatTimestamp(value: Date)`, and avatar fallbacks via `initialsFor()` — all from `src/lib/format.ts` (`initialsFor` was moved here to be shared; see the dates gotcha in [staff-profiles.md](./domains/staff-profiles.md)).

**Edit (Links + Client intro + Résumé cards).** Each editable card puts its **Edit button in the card header via `CardAction`** (`src/components/ui/card.tsx` — a header slot that right-aligns into the grid; use it for header-level affordances rather than absolutely positioning a button). The buttons live in `edit-links-dialog.tsx` / `edit-client-intro-dialog.tsx` / `edit-resume-dialog.tsx` — client components taking a **`staffId` prop** and opening a `Dialog`. The **inner form is remounted on each open** (mounted while `open`, or keyed by an open-counter as in the résumé dialog) so its `defaultValues` always reflect the latest server data after a save rather than going stale. The form uses **`useHookFormAction`** (tight binding; see `.claude/rules/forms.md`) wired to the `updateStaff*` action with the imported `.schema.ts` as the `zodResolver`; the Save button drives `loading` off `action.isPending`, server errors read off `action.result.serverError`, `onSuccess` closes the dialog. The edit is currently shown to **any signed-in user** on anyone's profile (ADR 0012) — gate this when RBAC lands.

The **résumé dialog additionally** has an "Upload PDF" button: it reads the file to base64 (`FileReader`, guarded to ~6 MB), runs the `parseResumePdf` action via a separate `useAction`, and on success `setValue`s the returned text into the textarea (dirty + validated) for review before the user saves via `updateStaffResume`. The PDF itself is never uploaded for storage — only its extracted text. Upload errors render inline. The résumé card shows the text with `whitespace-pre-wrap` plus an "Updated …" line from `formatTimestamp(resumeUpdatedAt)`. See [ADR 0013](./decisions/0013-resume-pdf-parse-not-store.md).

**History drawer.** The header's "History" button is `HistorySheet` (`src/components/staff/history-sheet.tsx`) — a **purely presentational** client component taking the `HistoryEntry[]` from `getStaffHistory()` and rendering each entry as a category `Badge` + date + summary inside a right-side `Sheet`. Category-agnostic, so new history sources (compensation, allocation) need no change here — see the history feed flow in [staff-profiles.md](./domains/staff-profiles.md).

### `/staff` — Browse staff directory

`(app)/staff/page.tsx` (Server Component) `await`s `getStaffDirectory()` once, then renders the `StaffDirectory` client component (`src/components/staff/staff-directory.tsx`) with the entries + filter options. **All search and filtering is client-side over that single server fetch:** name search, plus line-of-business / role / employment-type filters (options from `staffDirectoryFilterOptions`), plus an **"active only" toggle that defaults ON** — inactive staff are fetched but hidden until it's turned off. Results render as a card grid of `staff-card.tsx`, each linking to `/staff/[id]`.

## App shell & sidebar

`src/components/app-shell/`:

- `app-shell.tsx` — Client Component; wraps `SidebarProvider` and renders the sidebar plus a header showing the page title (`titleForPath(pathname)`). It sets `defaultOpen={false}` so the sidebar starts **collapsed as a floating icon island**. (`TooltipProvider` is no longer here — it now lives in the root layout; see below.)
- `app-sidebar.tsx` — the sidebar itself; uses `<Sidebar variant="floating" collapsible="icon">` (floating icon rail), `size-5` icons. Takes a `SessionUser` (name/email/image) passed down from the server layout. The open/close **toggle lives in its footer** — a `SidebarMenuButton` (Tabler `IconLayoutSidebar`) calling `useSidebar().toggleSidebar` (label toggles Expand/Collapse).
- `nav-user.tsx` — the user dropdown in the sidebar footer.
- `nav.ts` — the nav source of truth (no JSX, so it's importable anywhere).

Collapsed nav items get tooltips automatically via `SidebarMenuButton`'s `tooltip` prop (set to `item.title`).

**Add a nav item:** edit `NAV_ITEMS` in `src/components/app-shell/nav.ts` (`{ title, href, icon }` with a **Tabler** icon, typed as Tabler's `Icon`). It drives both the sidebar entries and the header title (`titleForPath` longest-prefix matches, falling back to `APP_NAME`). Nothing else to touch.

## Icon-only buttons (tooltip convention)

Icon-only controls must use **`IconButton`** (`src/components/icon-button.tsx`): it requires a `label`, which renders a **tooltip** and sets `aria-label` — so every icon button is discoverable and accessible. Don't ship a bare icon-only button. (Use it for standalone icon-only controls.)

`TooltipProvider` lives in the **root layout** (`src/app/layout.tsx`), not `AppShell`, so tooltips work app-wide (auth screens included). `IconButton` must render inside it — the root provider covers everything.

## Auth UI (Google-only)

- Sign in: `authClient.signIn.social({ provider: "google", callbackURL: "/" })` (`src/components/auth/google-sign-in-button.tsx`). On success the browser is redirected to Google, so the component only handles the error path.
- Sign out: `authClient.signOut()` then `router.replace("/login")` (`src/components/auth/sign-out-button.tsx`).
- Email/password is intentionally disabled server-side — see [decisions/0006](./decisions/0006-google-only-auth-and-layout-gating.md).

## Error / not-found / loading (Next 16 specifics)

This is a **modified Next.js build** — these conventions differ from public Next. Verify against `node_modules/next/dist/docs/` before changing them.

- `error.tsx` — **Client Component.** The retry prop is **`unstable_retry`** in this build, NOT `reset`. Call `unstable_retry()` to re-render the segment.
- `global-error.tsx` — replaces the root layout, so it renders its own `<html>`/`<body>` with inline styles (app CSS isn't available). Also takes `unstable_retry`. Keep it minimal and self-contained.
- `not-found.tsx` — Server Component; trigger with `notFound()` from `next/navigation`.
- `(app)/loading.tsx` — a Skeleton-based suspense fallback for the authenticated segment.

## See also

- `.claude/rules/ui.md` — the enforced, path-scoped working rules.
- [decisions/0005](./decisions/0005-ui-stack.md) — why shadcn/Base UI base-nova + indigo light theme.
- [decisions/0006](./decisions/0006-google-only-auth-and-layout-gating.md) — why Google-only and layout-based gating (not middleware).
- [architecture.md](./architecture.md) — where this fits in the stack.
</content>
</invoke>
