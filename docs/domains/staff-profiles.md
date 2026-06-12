# Domain: Staff profiles

**Status: proposed.** The People of the consultancy, and everything that describes their capacity and capability.

## Purpose

Be the source of truth about who works here — their role, skills, seniority, availability, and rates — feeding staffing decisions and performance.

## Key entities

- **Person** — an employee/contractor; anchors most of the system.
- **StaffProfile** (1:1 with Person) — role, seniority, availability, **cost rate** (what they cost us) and **charge rate** (what we bill).
- **Skill** (many:many with Person) — capability + proficiency level.

## Key flows

- **Profile maintenance** — keep skills, availability, and rates current. These are effective-dated: a rate or skill set valid *now* may differ from last quarter.
- **Skill matching** — Allocations query skills to find suitable People.

## Connects to

- **Allocations** — skills + availability drive staffing.
- **Timesheets** — rates turn logged hours into billing and margin.
- **Performance** — profile is the subject of reviews.

## Open questions

- Rate model: per Person, per role, or per Project override? Effective-dating approach.
- Skill taxonomy and proficiency scale.
- **Sensitivity:** rates/salaries need strict role-based access — see [../architecture.md](../architecture.md).
