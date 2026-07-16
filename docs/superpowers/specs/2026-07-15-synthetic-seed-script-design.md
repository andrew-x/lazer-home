# Synthetic data seed script — design

**Date:** 2026-07-15
**Status:** approved, ready for implementation plan

## Goal

A `bun run db:seed` script that populates the PSA platform's Postgres database
with rich, realistic synthetic data across every domain (auth/users, staff,
CRM, opportunities, projects, timesheets, performance). It reads the connection
from `DATABASE_URL` in the environment, uses a library for fake names and lorem
ipsum, and is structured to stay in lockstep with the data model as the schema
evolves.

## Non-goals

- Not a production data-import tool (that's the Rippling CSV sync).
- Not a general fixtures/testing harness — this is a dev-environment seed.
- Does not attempt real Google OAuth sessions; it seeds DB rows only.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Volume/realism | **Rich & realistic** (~40 staff, ~20 companies, ~40 contacts, ~30 opportunities across all stages, ~15 projects, several weeks of timesheets, feedback) |
| Re-run behavior | **Wipe & reseed** — truncate seedable tables in FK order, insert fresh |
| Login user | **Yes — `andrew@lazertechnologies.com` as `admin`**, linked to an active staff profile |
| Drift guard | **Type-safe (import real schema + enum sources) + doc rule** in AGENTS.md + librarian scope |

## Architecture

New `scripts/seed/` directory. This is a **deliberate, documented exception**
to the repo rule that DB access goes only through `src/actions/**` and `db` is
imported only there — a standalone dev tool talks to the DB directly. Called
out here so `/audit-quality` and the actions-layer rule don't flag it.

```
scripts/
  seed.ts              # entry: parse flags, connect, guard, wipe, run generators, summary, close
  seed/
    client.ts          # standalone postgres client from process.env.DATABASE_URL + safety guard
    wipe.ts            # TRUNCATE ... RESTART IDENTITY CASCADE of seedable tables
    faker.ts           # faker instance seeded with a fixed value (deterministic) + shared helpers
    world.ts           # the World type — accumulated created entities threaded between generators
    staff.ts           # users + staff (manager chains) + staff_employment + skills + staff_pto
    crm.ts             # companies + contacts (owners, self-ref managers)
    sales.ts           # opportunities (all stages) + owner/contact/source junctions
    projects.ts        # projects (some opportunity-linked) + delivery managers + project_roles
    timesheets.ts      # timesheets (draft+submitted) + time_entries (XOR project/category)
    performance.ts     # feedback
```

- **Client (`client.ts`)**: constructs its *own* `postgres(process.env.DATABASE_URL)`
  + `drizzle({ client, schema, casing: "snake_case" })` — not the app's
  `globalThis` hot-reload singleton — so the script owns the connection and can
  `.end()` cleanly on exit. Bun auto-loads `.env`, so `DATABASE_URL` is present.
- **Generators**: each `seedX(db, world): Promise<Partial<World>>` takes the
  accumulated `world` (already-created rows) and returns what it created, so
  dependents wire real FKs. The entry point runs them in dependency order and
  merges results into `world`.
- **IDs**: every non-`user` PK minted via `generateId("prefix")` from
  `src/lib/db/ids.ts`. `user.id` minted the same way (any unique text is valid;
  Better Auth normally generates it, a seed may supply its own).
- **Enums / constrained values**: imported from their single sources
  (`@/lib/line-of-business`, `@/lib/currency`, `@/lib/opportunity`,
  `@/lib/project-status`, `@/lib/project-role-type`, `@/lib/timesheet-category`,
  `@/lib/feedback-rating`, `@/lib/skills`, `@/lib/permissions`, and the inline
  role/employment/pto/timesheet-status enums from the schema). Never hardcoded.

## Data shape

- **Users + staff**: `andrew@lazertechnologies.com` → `user` (role `admin`,
  `emailVerified: true`) + linked active `staff` + one `staff_employment`.
  ~40 more staff with `userId: null`, unique `ripplingId`s, unique emails,
  self-referential `managerId` chains (managers inserted/resolved first), a
  handful of `StaffSkill`s from `ALL_SKILLS`, one `staff_employment` each
  (all four numeric comp columns set, `currency` set, `utilizationTarget: 0`
  when `isBillable: false`), and some `staff_pto` rows.
- **CRM**: ~20 companies (some `isPartner`, some with staff `ownerId`), ~40
  contacts (unique emails, `companyId`, staff `ownerId`, some self-ref
  `managerId` within the same company).
- **Opportunities**: ~30 spread across **all** `opportunity_status` values,
  varied `source`/`lineOfBusiness`, spaced `position` values, with owner /
  contact / source-contact / source-staff junctions.
- **Projects**: ~15, valid `companyId`; a few linked 1:1 to `closed_won`
  opportunities (respecting the partial-unique constraint); delivery managers;
  `project_roles` including some open (null `staffId`) placeholders.
- **Timesheets**: several recent ISO-Monday weeks per a subset of staff, mix of
  `draft` and `submitted` (`submittedAt` set only when submitted), `time_entries`
  within the week that satisfy the XOR check (exactly one of `projectId` /
  `category`), quarter/half `hours`.
- **Performance**: peer `feedback` between staff, varied `rating`, lorem prose in
  the optional fields.
- **Text**: faker names/emails/URLs; lorem ipsum for `clientIntro`, `resume`,
  opportunity `nextSteps`, feedback prose, project/opportunity names where a
  realistic label helps.

## Determinism

`@faker-js/faker` added as a **devDependency**; the shared faker instance is
`faker.seed(<fixed>)` so runs are reproducible. Combined with wipe & reseed,
every run yields the same dataset.

## Safety guard (remote DB)

Dev points at a remote (Neon) Postgres, so wipe truncates the real dev DB.
Before truncating, `client.ts` / entry point:

1. Prints the target host from `DATABASE_URL`.
2. Refuses if the host looks production-ish (contains `prod`) unless an explicit
   override flag is passed.
3. Requires interactive `y` confirmation, skippable with `--yes` (for CI/scripted use).

## package.json

- Add `"db:seed": "bun run scripts/seed.ts"`.
- Add `@faker-js/faker` to `devDependencies`.

## Drift guard (stay in sync with the data model)

1. **Type safety**: the script imports the real Drizzle table objects and enum
   value arrays; `bun run check` (`tsc --noEmit`) fails on schema drift
   (renamed columns, changed enum members, new NOT NULL columns).
2. **Doc rule**: add a short note in `AGENTS.md` (and mirror per the two-runtime
   parity rule) that schema/data-model changes must update `scripts/seed/`, and
   include the seed script in the librarian's reconciliation scope.

## Verification

- `bun run check` passes (types + lint).
- `bun run db:seed --yes` against a dev DB completes and prints a summary of
  row counts per table.
- Spot-check in the app: sign in as `andrew@lazertechnologies.com`, confirm the
  directory, CRM pipeline/kanban, projects, timesheets, and feedback screens are
  populated and coherent.
