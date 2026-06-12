# Data model — the spine

The five domains share one model. This is the most important doc for understanding the system: changes here ripple everywhere.

**Status: mostly proposed.** Entities and relationships below are the intended design. Only the **Person** anchor and a minimal **StaffProfile** example exist in code so far (see "What's realized in code").

## What's realized in code

- **Person** is realized by better-auth's **`user`** table (`src/lib/db/auth-schema.ts`) — it is the system anchor, and app tables FK to `user.id`. (`user`/`session`/`account`/`verification` live in our schema and migrations, not better-auth's.)
- **`staff_profile`** (`src/lib/db/schema.ts`) is an example table realizing the **StaffProfile** concept: 1:1 with `user` (`userId` unique FK, `onDelete: cascade`), CUID2 prefixed PK, `$onUpdate` timestamp. It currently carries only `title`/`bio` — scaffolding to demonstrate the conventions, to be extended with the real fields (role, seniority, rates, availability).
- Nothing else (Client, Project, Allocation, TimeEntry, reviews) exists yet.

## Core entities

- **Person** — an employee/contractor. Anchors most of the system.
  - **StaffProfile** (1:1 with Person) — role, seniority, skills, availability, cost rate, charge rate.
  - **Skill** (many:many with Person) — capability + proficiency; used to match people to allocations.
- **Client** — a customer organisation (CRM).
  - **Contact** (many per Client) — a person at the client.
  - **Opportunity** — a pipeline deal for a Client; when *won*, becomes/links to a Project.
- **Project** (a.k.a. engagement) — billable work for a Client. The hub linking CRM ↔ delivery.
- **Allocation** — a *time-ranged* assignment of a Person to a Project (start/end, % or hours, project role). The heart of capacity planning.
- **TimeEntry** — hours a Person logged against a Project (and optionally a task) on a date; billable or not. Aggregated into **Timesheets** for approval.
- **ReviewCycle / PerformanceReview / Goal** — periodic assessment of a Person, often informed by their project work and utilization.

## How the domains connect

```
Client ──< Opportunity ──(won)──> Project
Client ──< Project
Project >──< Person      via Allocation   (the plan, time-ranged)
Person  ──< TimeEntry >── Project          (the actuals)
Person  ──1 StaffProfile ──< Skill
Person  ──< PerformanceReview              (within a ReviewCycle)
```

## Key derived concepts

- **Utilization** = billable hours ÷ available hours for a Person over a period. Drives capacity (for allocations) and feeds performance.
- **Forecast vs. actuals** — Allocations are the *plan*; TimeEntries are the *actuals*. Comparing them is a central reporting need.
- **Margin** = (charge rate − cost rate) × billable hours, per Project/Person.

## Nuances to respect

- Everything time-bound (allocations, rates, reviews) needs effective-dated handling — a person's rate or skills change over time.
- Rates and salaries are highly sensitive — see authorization in [architecture.md](./architecture.md).
