# Domain: Staff profiles

**Status: partially realized.** The People of the consultancy, and everything that describes their capacity and capability. The core `staff` + `staff_employment` + `staff_pto` tables now exist in code (`src/lib/db/staff-schema.ts`, barrelled by `src/lib/db/schema.ts`), and two local-only **CSV import tools** populate them from Rippling exports — staff and PTO (see *Import tools* below). A self-service **"My profile"** page (`/profile`) surfaces a logged-in person's own record, and a **browse-staff** feature adds a **directory** (`/staff`) and **per-person profile pages** (`/staff/[id]`) that show *other people's* records via the same presentation; both let you **edit profile links and client intro** (currently open to any signed-in user — see *Authorization*) and show a **category-agnostic history feed** (see *Key flows*); skills, rates, and seniority are still proposed.

## Purpose

Be the source of truth about who works here — their identity, role, line of business, billability, and utilization target — feeding staffing decisions and performance.

## Key entities

- **`staff`** — the *durable* record of a person: `ripplingId` (**notNull, unique** — the external [Rippling](https://rippling.com) HR id; the import's match key), `name`, `email` (**not unique** — duplicates are tolerated), an optional `userId` link to the auth `user` (see below), profile links (`linkedinUrl`/`githubUrl`/`portfolioUrl`), a `clientIntro` blurb (with its own `clientIntroUpdatedAt`), and lifecycle dates (`joinDate`, `terminationDate`, `isActive`). Holds nothing that changes role-to-role.
  - **`userId`** — nullable, unique FK → auth `user.id` (`onDelete: set null`). The optional 1:1 link from a staff record to its login account: **null until the person signs in** (staff can be synced from Rippling before they ever log in), **unique** so at most one staff per user, and `set null` on delete so removing the auth account keeps the durable staff record intact.
- **`staff_employment`** — the *time-varying* employment facts for a person. **One row per change**, not an update-in-place: each row is keyed by `effectiveFromDate` (notNull) and the **current state is the row with the latest `effectiveFromDate`**. FK `staffId` → `staff.id` (`onDelete: cascade`). Fields: `lineOfBusiness`, `role`, `employmentType`, `isBillable`, `utilizationTarget` (integer percent 0–100), and `billableType` (nullable). (The external `ripplingId` lives on `staff`, not here.) See [ADR 0007](../decisions/0007-staff-employment-effective-dating.md) for *why* employment is split out and history-as-rows.
- **`staff_pto`** — leave records for a person: `startDate`/`endDate` (both date, notNull), `type` (`ptoTypeEnum`), and `isPending` (bool, default `true`). FK `staffId` → `staff.id` (`onDelete: cascade`), plus a **notNull, unique `ripplingId`** — the Rippling "Leave request ID", the PTO import's match key (one record per leave request). Unlike `staff_employment`, this is **not** effective-dated history — each row is a discrete leave span. `isPending` means awaiting approval; it's cleared on approval, or set `false` on insert when the row is synced from Rippling as already-approved. Populated by the PTO import tool (see below).
- **Skill** (many:many with Person) — capability + proficiency level. **Status: proposed**, not built.

### Enums (`src/lib/db/staff-schema.ts`)

- `lineOfBusiness`: `CORPORATE`, `CORE`, `FINTECH`, `COMMERCE`, `DESIGN` — **shared/global**, not staff-specific (top-level export reused by CRM/allocations).
- `role`: `ENGINEER`, `DESIGNER`, `MANAGEMENT`, `SALES`, `SOLUTIONS`, `OPERATIONS`, `ARCHITECT`, `DELIVERY`, `QA`
- `employmentType`: `FULL_TIME`, `HOURLY`
- `billableType`: `HUB`, `GLOBAL` (nullable — only meaningful when `isBillable`)
- `pto_type`: `VACATION`, `STATUTORY_HOLIDAY`, `SICK_LEAVE`, `UNPAID_LEAVE`, `PARENTAL_LEAVE`, `BEREAVEMENT_LEAVE`, `COMPANY_RETREAT`, `RELIGIOUS_HOLIDAY`, `OTHER_LEAVE` — **enum order matters** (it's the on-disk order). `COMPANY_RETREAT`/`RELIGIOUS_HOLIDAY` were added before `OTHER_LEAVE` via `ALTER TYPE ... ADD VALUE` (`drizzle/0007_orange_thundra.sql`); the tuple in `src/lib/pto-import/types.ts` mirrors it so a Drizzle insert type-checks drift at compile time.

## Nuances / gotchas

- **Read the latest employment row.** Don't assume one row per person — query `staff_employment` ordered by `effectiveFromDate desc` (filtered to `<= today` for as-of reads) to get current facts. Inserting a new row is how you "change" someone's role/billability.
- **`utilizationTarget` defaults to 100** for billable staff. Callers must set it to `0` when `isBillable` is false — the DB does not enforce that coupling.
- **PTO `isPending` defaults to `true`.** Rippling-sync inserts of already-approved leave must explicitly write `isPending: false`. Capacity/availability reads should account for pending vs. approved leave deliberately.
- **`staff.userId` is the auth link, and it's often null.** A logged-in user maps to their staff record via `staff.userId = user.id`, but the link is **null** for anyone synced from Rippling who hasn't signed in yet. Don't assume every staff row has a user (or vice versa). `email` is no longer unique, so do **not** match identity for general queries by email. (The legacy `staff_profile` example that was 1:1 with `user` has been deleted.) The **one** place email matching is allowed is the first-login auto-link below, which writes `userId` so subsequent reads go through the FK.
- **Login is gated on an active staff record with employment.** `getCurrentStaff(user)` (`src/lib/staff.ts`) is the gate run by the `(app)` layout: it returns `ok` only for an `isActive` staff row that has ≥1 `staff_employment` row; `incomplete` if active-but-no-employment; `not_setup` otherwise. So a freshly synced staff row with no employment history can't get its person into the app — employment must be populated first. See the auth flow in [flows.md](../flows.md).
- **First-login auto-link (email → `userId`).** `getCurrentStaff` first looks up by `staff.userId`; if none, it falls back to the active staff row matching `user.email` and writes `staff.userId = user.id`, **guarded on `userId IS NULL`** so it fires at most once and concurrent logins are safe. This is the bridge from email-synced staff to authenticated sessions; it's the only sanctioned email-based identity match.
- **A `staff` row is a tenure, not a permanent person.** Leavers are marked inactive (`isActive = false`, `terminationDate` set), never deleted. A rehire gets a **brand-new `staff` row** (new id, fresh `joinDate`, its own employment history) — we never reactivate the old one. So one human can be several staff rows over time, and there's **no cross-tenure "person" entity** linking them. Don't assume `staff` ↔ human is 1:1; queries that must follow a person across stints have to aggregate multiple rows. See [ADR 0007 — Leavers and rejoiners](../decisions/0007-staff-employment-effective-dating.md).
- **Dates/times are timezone-agnostic.** `joinDate`/`terminationDate`, `effectiveFromDate`, and PTO `startDate`/`endDate` are `date()` strings (`"YYYY-MM-DD"`); `clientIntroUpdatedAt` and other instants are `timestamp` without time zone. Do zone conversion at the UI edge only — see [`.claude/rules/database.md`](../../.claude/rules/database.md).
- **Edits are currently open to any signed-in user (temporary).** `updateStaffLinks`/`updateStaffClientIntro` take a `staffId` and edit *any* staff member's links/intro — the prior owner-scoping was **deliberately dropped** to ship the directory. `secureActionClient` still requires a session, so it's "any logged-in employee," not the public. Flagged `// TODO: lock down to owner/admin later`; lock-down lands with the role model. See [ADR 0012](../decisions/0012-open-staff-edit-pending-rbac.md).
- **Cross-person reads aren't scoped either, by design.** `getStaffProfile`/`History`/`Pto`/`Avatar` show other people for the directory; the `(app)` layout gate is the only boundary. **Inactive staff profiles are readable by direct `/staff/[id]` URL** (the directory hides them; the read doesn't). Consistent with the internal-only posture.
- **`getStaffDirectory` scans the whole `staff_employment` table** and reduces to latest-per-staff in JS. Fine at company scale; if effective-dating history grows large, switch to `DISTINCT ON (staff_id)` / a lateral join. There is **no composite index on `(staff_id, effective_from_date)`** yet.

## Import tools (localhost-only admin)

The only way this domain currently gets populated: two **local-only** CSV importers in the `admin` area (outside `(app)`, gated on a loopback host) — `/admin/upload-staff` (people) and `/admin/upload-pto` (leave). They live outside `(app)` precisely because they *create* the staff records the `(app)` layout gates on — see [architecture.md](../architecture.md) (Admin area, [ADR 0008](../decisions/0008-localhost-only-admin-area.md)) and [flows.md](../flows.md) for the gating rationale and end-to-end steps. Both follow the same shape: pure client transform → server `compute*Plan` diff → preview tables → commit action that **recomputes the plan server-side** and applies it in one transaction (`publicActionClient` + `assertLocalhost()`, never `secureActionClient`).

### Staff import (`/admin/upload-staff`)

Ingests a [Rippling](https://rippling.com) employee export into `staff` + `staff_employment`.

Code: client `src/components/admin/staff-import.tsx` (PapaParse + preview tables); pure transform `src/lib/staff-import/transform.ts`; server diff `src/lib/staff-import/plan.ts`; shared types/zod `src/lib/staff-import/types.ts`; actions `src/actions/admin/{previewStaffImport,commitStaffImport}.ts` (both `publicActionClient` + `assertLocalhost()` — local seeding must not require auth/staff).

### CSV column mapping

`Employee - ID`→`ripplingId`, `Employee - name`→`name`, `Work email`→`email`, `Start date`→`joinDate`, `Last day of work`→`terminationDate`. Column lookup is whitespace/case-tolerant; dates accept ISO (`YYYY-MM-DD`) or US (`M/D/YYYY`), blank → null. A row missing any of id/name/email, or with an unparseable date, is **skipped** (surfaced, never persisted).

### Derivation rules (the non-obvious nuance — keep in sync with `transform.ts`)

- **`lineOfBusiness`:** Department=="Design" → `DESIGN`; else first match in Teams: core→`CORE`, commerce→`COMMERCE`, corporate→`CORPORATE`, fintech/crypto→`FINTECH`. **Unmappable → row skipped.**
- **`role`** (first match wins): Dept Design→`DESIGNER`; Dept Talent→`OPERATIONS`; Dept Sales→`SALES`; Title contains Delivery→`DELIVERY`; Architect→`ARCHITECT`; QA→`QA`; Engineer→`ENGINEER`; else `OPERATIONS`.
- **`employmentType`:** "Employment type name" contains "Hourly" → `HOURLY`, else `FULL_TIME`.
- **`isActive`** = no `terminationDate`. **`isBillable`** = role NOT in {MANAGEMENT, SALES, SOLUTIONS, OPERATIONS}. **`utilizationTarget`** = `isBillable ? 100 : 0`.

### Persistence (respects ADR 0007 effective dating)

Matching is by `ripplingId`. The server **recomputes the diff** (`computeImportPlan`) — the client preview is never trusted — and commits in one transaction:
- **Create** → new `staff` row + initial `staffEmployment` (`effectiveFromDate = joinDate ?? today`).
- **Update** → `staff` identity fields written in place; a **new** `staffEmployment` row (`effectiveFromDate = today`) inserted **only when an employment fact changed** (the "latest row wins" pattern), so identity-only edits don't churn employment history.

**Gotcha:** duplicate `ripplingId`s *within one CSV* are not de-duped (a Rippling export shouldn't contain them); a genuine duplicate fails the commit transaction on the `staff.ripplingId` unique constraint.

### PTO import (`/admin/upload-pto`)

Mirrors the staff importer (clone of `staff-import.tsx`), ingesting a Rippling **leave** export into `staff_pto`. Code: client `src/components/admin/pto-import.tsx`; pure transform `src/lib/pto-import/transform.ts` (reuses the same `getField`/`parseDate` helpers as staff-import); server diff `src/lib/pto-import/plan.ts`; shared types/zod `src/lib/pto-import/types.ts`; actions `src/actions/admin/{previewPtoImport,commitPtoImport}.ts` (+ `ptoImport.schema.ts`).

The defining difference from the staff importer: rows can **delete** as well as upsert, and matching is **two-level**. See [ADR 0009](../decisions/0009-pto-import-cancel-as-delete.md) for *why* cancellations delete and what "destructive re-sync" implies.

#### CSV column mapping

`Leave request ID`→`staffPto.ripplingId` (the PTO record key), `Employee - ID`→resolves the staff member (`staff.ripplingId`), `Employee`→display name, `Start date`→`startDate`, `Leave end date`→`endDate`. Same whitespace/case-tolerant lookup and ISO/US date parsing as staff-import. A row missing `Leave request ID` or `Employee - ID` is **skipped**.

#### Derivation rules (keep in sync with `transform.ts`)

- **`Leave request status` → action + `isPending`:** `APPROVED` → upsert, `isPending=false`; `Pending` → upsert, `isPending=true`; `REJECTED`/`CANCELED`/`CANCELLED` → **delete** action (remove the record if it exists). Anything else → row **skipped** (unrecognized status).
- **`Leave policy custom name` → `type`** (case-insensitive substring, first match): "unlimited vacation"→`VACATION`; "family medical leave"/"sick leave"→`SICK_LEAVE`; "statutory holiday"→`STATUTORY_HOLIDAY`; "company retreat"→`COMPANY_RETREAT`; "religious holiday"→`RELIGIOUS_HOLIDAY`; "bereavement leave"→`BEREAVEMENT_LEAVE`. **No match → row skipped** ("Unrecognized leave type").
- For `upsert` rows, a missing/unparseable `Start date` or `Leave end date` **skips** the row. `delete` rows skip date/type derivation entirely (a cancelled request may have neither) — they carry only the leave-request id.

#### Persistence (`computePtoImportPlan` → `commitPtoImport`)

Two-level diff: resolve staff by `Employee - ID`, then match the PTO record by `Leave request ID`. The plan buckets are `creates` / `updates` (changed-field marked) / `deletes` / `unresolved` / `unchanged` / `ignoredCancellations`. Commit recomputes server-side and runs one transaction: insert creates, `update` changed rows by **id**, delete cancelled/rejected rows by **leave-request id**.

**Gotchas:**
- **Unresolved, not skipped, when staff is missing.** An upsert row whose `Employee - ID` matches no `staff` row is surfaced as `unresolved` (it can't be inserted without the staff FK) — distinct from the client-side `skipped` rows. Import staff first.
- **Delete is keyed independently of staff.** A `delete` row removes any existing record by its leave-request id even if the employee can't be resolved; with no matching record it's counted as `ignoredCancellations` (a cancel for leave we never imported is a no-op).
- Same intra-CSV duplicate-`ripplingId` guard as staff-import — the transform skips a second occurrence of a `Leave request ID` to avoid a unique-constraint rollback.

## Key flows

- **Login gating** — on first authenticated request `getCurrentStaff` resolves user → staff (auto-linking by email once), and the `(app)` layout admits only `ok`; `not_setup`/`incomplete` are bounced to the single `/profile-setup` block screen. See [flows.md](../flows.md).
- **Employment change** — insert a new `staff_employment` row with a new `effectiveFromDate` rather than mutating the prior row, preserving history.
- **Profile read (by id — `/profile` and `/staff/[id]`)** — the per-person reads are now **parameterized by `staffId`** and not ownership-scoped: `getStaffProfile(staffId)` (`src/actions/staff/getStaffProfile.ts`), `getStaffHistory(staffId)`, `getStaffPto(staffId)`, `getStaffAvatar(staffId)`. `getStaffProfile` returns latest employment via the ADR 0007 ordering (and is wrapped in `React.cache` so `/staff/[id]`'s `generateMetadata` and page body share one query). `getStaffAvatar` reads the linked auth `user.image` (separate query because the avatar lives on `user`, not `staff`; null when unlinked).
  - **Self read** — `getMyProfile`/`getMyHistory`/`getMyPto` are now **thin wrappers**: each resolves the current staff id via `getCurrentStaffId()` (`src/actions/staff/getCurrentStaffId.ts`, `React.cache`d, `staff.userId = user.id` → id or null) and delegates to the `getStaff*` core. `MyProfile` is a back-compat alias of `StaffProfile`. The page never touches `db` (ADR 0010). See [ui.md](../ui.md) (`/profile`).
  - **Why not ownership-scoped:** the directory and `/staff/[id]` deliberately show other people, so these reads can't filter by `userId`. Access is the `(app)` layout's session+staff gate only. This softens ADR 0010's "inherently self-scoped" property for cross-person data — see *Authorization* below and [ADR 0012](../decisions/0012-open-staff-edit-pending-rbac.md).
- **Directory ("Browse staff", `/staff`)** — `getStaffDirectory()` (`src/actions/staff/getStaffDirectory.ts`) returns one `StaffDirectoryEntry` per staff member (identity + `isActive` + avatar + latest employment facts; employment fields null when no history). **Two queries, no N+1:** all staff (left-joined to `user` for the avatar), then the *entire* `staff_employment` table ordered newest-first and reduced in JS to keep the latest row per `staffId`. Includes inactive staff so the UI's "active only" toggle (defaults ON) can hide/show them client-side. It also exports `staffDirectoryFilterOptions` (line-of-business / role / employment-type enum values) so the page gets filter options without importing the Drizzle schema. All search + filtering is **client-side** over this single server fetch (`StaffDirectory` component). See *Authorization* (whole-table scan tradeoff) and [ui.md](../ui.md).
- **Edit (links + client intro)** — the two `secureActionClient` mutations were renamed to `updateStaffLinks` (`src/actions/staff/updateStaffLinks.ts`) and `updateStaffClientIntro`, both now taking an explicit **`staffId`** and editing that row by id (no longer scoped to the caller's own record — see *Authorization*). `.returning()` confirms a row matched (→ `UserSafeActionError` if not). `updateStaffClientIntro` stamps `clientIntroUpdatedAt`. Both revalidate `/profile` and `/staff/${staffId}`. Schema rules unchanged: URL fields empty-string→null else valid URL; client intro trimmed, max 2000, empty→null; schemas in their own `.schema.ts` files so the dialogs import them for the resolver (never export a schema from a `'use server'` file — `.claude/rules/forms.md`). The edit dialogs (`edit-links-dialog.tsx`, `edit-client-intro-dialog.tsx`) take a `staffId` prop so `/profile` and `/staff/[id]` share them. UI in [ui.md](../ui.md).
- **History feed (`/profile` + `/staff/[id]`)** — `getStaffHistory(staffId)` (`src/actions/staff/getStaffHistory.ts`, with `getMyHistory` as its self-resolving wrapper) is a server-only read returning a **category-agnostic** `HistoryEntry[]` (`{ id, date, category, summary }`, `HistoryCategory = "EMPLOYMENT" | "COMPENSATION" | "ALLOCATION"`), newest first, for the given staff id (not ownership-scoped — see *Authorization*). **Today only `staffEmployment` rows are mapped** (EMPLOYMENT entries, ordered per ADR 0007). It's deliberately structured so compensation and project-allocation sources each get added as their own fetch + map, pushed into the same array, then merged by the single stable sort (date strings are `"YYYY-MM-DD"`, so lexicographic compare is chronological and equal-date entries keep per-source order). Adding a source needs no change to the consuming UI (`HistorySheet` is purely presentational). Rendered by the `HistorySheet` drawer — see [ui.md](../ui.md). For *why* the feed is category-agnostic and merged server-side (and what the removed employment-specific drawer was), see [ADR 0011](../decisions/0011-category-agnostic-history-feed.md).
- **Profile maintenance** — keep skills, availability, and rates current (skills/rates still proposed; only links + client intro have a self-edit UI today).
- **Skill matching** — Allocations query skills to find suitable People (proposed).

## Connects to

- **Allocations** — role, line of business, and `utilizationTarget` drive staffing and capacity; `staff_pto` spans reduce available capacity over their date range.
- **Timesheets** — `isBillable`/`billableType` and (future) rates turn logged hours into billing and margin.
- **Performance** — profile is the subject of reviews.

## Open questions

- Rate/cost model and where it lives (likely another effective-dated table alongside `staff_employment`).
- Skill taxonomy and proficiency scale.
- **Sensitivity:** rates/salaries need strict role-based access — see [../architecture.md](../architecture.md).
- **Cross-tenure identity:** no `person` entity links a human's multiple `staff` rows across leave/rehire stints (see *Nuances*). If tenure-spanning reporting or "have we worked with them before" becomes a need, this is the gap to fill.

> **Resolved:** linking `staff` ↔ auth `user` is now the nullable, unique `staff.userId` FK (`onDelete: set null`) — an optional 1:1 link, null until first sign-in. Identity is no longer keyed off email (`staff.email` is no longer unique). See Key entities above.
