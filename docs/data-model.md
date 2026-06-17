# Data model — the spine

The five domains share one model. This is the most important doc for understanding the system: changes here ripple everywhere.

**Status: mostly proposed.** Entities and relationships below are the intended design. Only the **Person** anchor (auth `user`) and the **Staff profiles** tables (`staff`, `staff_employment`, `staff_pto`) exist in code so far (see "What's realized in code").

## What's realized in code

- **Person** is realized by better-auth's **`user`** table (`src/lib/db/auth-schema.ts`) — the _login/identity_ anchor. (`user`/`session`/`account`/`verification` live in our schema and migrations, not better-auth's.) A logged-in user maps to its staff record via the nullable, unique **`staff.userId`** FK (`onDelete: set null`) — see [domains/staff-profiles.md](./domains/staff-profiles.md).
- **Staff profiles domain** (`src/lib/db/staff-schema.ts`, barrelled by `src/lib/db/schema.ts`):
  - **`staff`** — the durable person record (notNull/unique external `ripplingId`, name, non-unique email, optional `userId` link to auth `user`, profile links, `clientIntro`, lifecycle dates, `isActive`).
  - **`staff_employment`** — time-varying employment facts (line of business, role, employment type, billability, `utilizationTarget`, `billableType`), as **one effective-dated row per change**; current state = latest `effectiveFromDate`. FK → `staff.id` cascade. See [ADR 0007](./decisions/0007-staff-employment-effective-dating.md) and [domains/staff-profiles.md](./domains/staff-profiles.md).
  - **`staff_pto`** — leave spans (`startDate`/`endDate`, `type`, `isPending`, **notNull/unique `ripplingId`** = Rippling "Leave request ID"). FK → `staff.id` cascade. Discrete rows, **not** effective-dated; reduces a person's available capacity for allocations. Populated by a second local-only importer (`/admin/upload-pto`) — see [domains/staff-profiles.md](./domains/staff-profiles.md).
- **`lineOfBusinessEnum`** (`line_of_business`: `CORPORATE`, `CORE`, `FINTECH`, `COMMERCE`, `DESIGN`) is a **shared/global enum**, exported top-level and intended for reuse beyond staff (CRM/allocations), not a staff-specific type.
- **Local-only CSV import tools** are the only things that write this domain so far: `/admin/upload-staff` (Rippling export → `staff` + effective-dated `staff_employment`) and `/admin/upload-pto` (Rippling leave export → `staff_pto`). See [domains/staff-profiles.md](./domains/staff-profiles.md).
- Nothing else (Client, Project, Allocation, TimeEntry, reviews) exists yet. (The legacy `staff_profile` example table was deleted — `drizzle/0003_tranquil_miek.sql` drops it.)

## Core entities

- **Person** — an employee/contractor. Anchors most of the system. Realized as **`staff`** (durable identity) + **`staff_employment`** (effective-dated role/billability facts); login identity is the auth `user`, linked via the optional `staff.userId` (1:1, null until first sign-in).
  - **Skill** (many:many with Person) — capability + proficiency; used to match people to allocations. _(Proposed — not built.)_
  - Rates (cost/charge) are expected to follow the same effective-dated, history-as-rows pattern as `staff_employment`.
- **Client** — a customer organisation (CRM).
  - **Contact** (many per Client) — a person at the client.
  - **Opportunity** — a pipeline deal for a Client; when _won_, becomes/links to a Project.
- **Project** (a.k.a. engagement) — billable work for a Client. The hub linking CRM ↔ delivery.
- **Allocation** — a _time-ranged_ assignment of a Person to a Project (start/end, % or hours, project role). The heart of capacity planning.
- **TimeEntry** — hours a Person logged against a Project (and optionally a task) on a date; billable or not. Aggregated into **Timesheets** for approval.
- **ReviewCycle / PerformanceReview / Goal** — periodic assessment of a Person, often informed by their project work and utilization.

## How the domains connect

```
Client ──< Opportunity ──(won)──> Project
Client ──< Project
Project >──< Person      via Allocation   (the plan, time-ranged)
Person  ──< TimeEntry >── Project          (the actuals)
user (auth)    ──0:1── Person (staff)      via staff.userId (nullable, unique)
Person (staff) ──< StaffEmployment         (effective-dated; latest = current)
Person (staff) ──< StaffPto                 (leave spans; reduce capacity)
Person  ──< Skill                          (proposed)
Person  ──< PerformanceReview              (within a ReviewCycle)
```

## Key derived concepts

- **Utilization** = billable hours ÷ available hours for a Person over a period. Drives capacity (for allocations) and feeds performance.
- **Forecast vs. actuals** — Allocations are the _plan_; TimeEntries are the _actuals_. Comparing them is a central reporting need.
- **Margin** = (charge rate − cost rate) × billable hours, per Project/Person.

## Nuances to respect

- Everything time-bound (allocations, rates, reviews, **employment**) needs effective-dated handling — a person's role, rate, or skills change over time. The realized pattern is **history-as-rows** (`staff_employment`): a new row per change, current state = latest `effectiveFromDate`. See [ADR 0007](./decisions/0007-staff-employment-effective-dating.md).
- Rates and salaries are highly sensitive — see authorization in [architecture.md](./architecture.md).
- **Dates and times are timezone-agnostic.** Calendar dates (effective-from, PTO spans, join/termination) are `date()` strings (`"YYYY-MM-DD"`, no zone); instants are plain `timestamp` _without_ time zone — treat all stored datetimes as wall-clock and convert zones only at the UI edge. See [`.claude/rules/database.md`](../.claude/rules/database.md).
