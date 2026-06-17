# Browse Staff — directory + per-person profile

**Date:** 2026-06-17
**Status:** Approved (pending spec review)

## Goal

Add a staff **directory** that any authenticated user can browse, with name search
and filters, and a per-person **profile** page reached by clicking someone. The
profile reuses the existing self-`/profile` machinery so the two stay in lockstep.

## Scope decisions (settled in brainstorming)

- **Presentation:** card grid (avatar, name, `Role · LoB`, billable badge), not a table.
- **Filters:** name search + Line of business + Role + Type (= **employment type**,
  Full-time/Hourly) + an **"Active only" toggle defaulting to ON**.
- **Filtering is fully client-side.** The page fetches all staff once; no server round-trips per keystroke.
- **Inactive staff are fetched** (so the toggle can reveal them) but hidden by default.
  Accepted: former employees are browsable in this internal tool.
- **Profile content** mirrors the current `/profile` page exactly.
- **Editing links + client intro is open to any authenticated user** for now
  (`// TODO: lock down to owner/admin later`). No per-owner scoping.

## Routes & navigation

- `src/app/(app)/staff/page.tsx` — directory. Server component; `(app)` layout gates auth + staff record.
- `src/app/(app)/staff/[id]/page.tsx` — per-person profile. `notFound()` when the id doesn't resolve.
  Next 16 in this repo passes `params` as a **Promise** — confirm against
  `node_modules/next/dist/docs/` before writing the route; `await params`.
- Add a **"Staff"** item (`IconUsers`) to `NAV_ITEMS` in `src/components/app-shell/nav.ts`
  (drives both sidebar icon and header title).

## Data layer (reuse via parameterization)

Extract parameterized cores; the existing `getMy*` functions become thin wrappers that
resolve the current staff id (via `getCurrentUser()` + the `staff.userId` lookup) and delegate.

- `getStaffProfile(staffId)` ← core of `getMyProfile()`
- `getStaffHistory(staffId)` ← core of `getMyHistory()`
- `getStaffPto(staffId)` ← core of `getMyPto()`
- `getMyProfile()` / `getMyHistory()` / `getMyPto()` keep their current signatures and behavior.

New directory read — `src/actions/staff/getStaffDirectory.ts` (plain async, `server-only`):

- Query A: all `staff` rows (active **and** inactive), `leftJoin user` for `user.image`.
  Explicit column projection per the database rule.
- Query B: all `staffEmployment` rows for those staff, ordered
  `desc(effectiveFromDate), desc(createdAt)`; reduce in JS to the **latest row per staffId**.
- Returns: `Array<{ id, name, email, isActive, imageUrl: string | null,
  lineOfBusiness, role, employmentType, isBillable }>`. Staff with no employment row
  get `null` employment fields (still listed). **Two queries total — no N+1.**

Filter dropdown option lists come from the enum value arrays exported by
`src/lib/db/staff-schema.ts` (`lineOfBusinessEnum`, `roleEnum`, `employmentTypeEnum`),
labeled with `humanizeEnum`.

## Mutations (reuse via generalization)

- `updateMyLinks` → `updateStaffLinks` — input gains `staffId`; updates that row.
  Drop the `eq(staff.userId, ctx.user.id)` scoping. Still behind `secureActionClient`
  (authenticated session required). Add `// TODO: lock down to owner/admin later`.
- `updateMyClientIntro` → `updateStaffClientIntro` — same change; keeps the
  `clientIntroUpdatedAt` bump and 2000-char cap.
- `EditLinksDialog` / `EditClientIntroDialog` gain a `staffId` prop, threaded into the action call.

## Components

Shared, under `src/components/staff/`:

- `staff-directory.tsx` (**client**) — holds filter state, renders the grid + controls.
  Props: the directory array. Filters: search `Input`, three `Select` dropdowns (with "All"),
  an "Active only" toggle (`Switch` or `Checkbox`), default on. Empty-state line.
- `staff-card.tsx` — one card; `Avatar` (image or initials), name, `Role · LoB`,
  billable `Badge`. Whole card links to `/staff/[id]` via Base UI `render={<Link/>}`.
- `profile-view.tsx` (**server**) — header (avatar/name/employment summary/billable badge)
  + `LinksCard` + `ClientIntroCard` + `PtoSection` + `HistorySheet`. Props:
  `{ staffId, imageUrl, profile, history, pto }`. Renders the edit dialogs (open to all).
- `LinkRow` (currently inline in `/profile/page.tsx`) moves into the shared layer.
- `PtoSection`, `HistorySheet` — **reused as-is** (already presentational).

`/profile/page.tsx` and `/staff/[id]/page.tsx` both fetch their data and render `<ProfileView />`.
`/profile` resolves "me"; `/staff/[id]` resolves by route param.

## Conventions

shadcn on Base UI (add `select` / `switch` if missing via `bunx --bun shadcn@latest add`),
Tabler icons, flat + sharp surfaces, semantic color classes, `"YYYY-MM-DD"` dates,
explicit Drizzle column projection.

## Verification & follow-up

- `bun run check` (Biome + tsc) and `bun run build`.
- Manual: directory loads, search/filters/toggle work, card → profile navigates,
  editing links/intro from `/staff/[id]` persists.
- Dispatch the `librarian` subagent to reconcile `/docs` (new directory feature,
  generalized actions, opened-up edit auth) once implemented.

## Out of scope

- Server-side search/pagination (client-side is sufficient at current staff count).
- Owner/admin authorization on edits (deferred — flagged with TODO).
- Skills, rates, availability beyond the existing PTO section.
