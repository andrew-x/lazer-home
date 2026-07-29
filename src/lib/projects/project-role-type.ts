/**
 * The role types (disciplines) a project staffing line can be. Declared here as a
 * pure, client-importable module (no `db`/drizzle) so the `projectRoleTypeEnum`
 * pgEnum in `projects-schema.ts`, the zod enum in `createProject.schema.ts`, and
 * the create-project form all share exactly one source of truth — mirrors
 * `@/lib/crm/line-of-business`. A role's type is its discipline (what kind of work);
 * it's orthogonal to line of business (which practice bills it). See
 * docs/domains/projects.md.
 */

// Keep this `import type`. `projects-schema.ts` imports this module for VALUES
// (the pgEnum), so a value import from `staff-enums` — which reads its unions out
// of `@/lib/db/staff-schema` — would close a runtime cycle through the schema.
// Types are erased, so this is free. Same caveat as `compensation-targets.ts`.
import type { Role } from "@/lib/staff/staff-enums";

export const PROJECT_ROLE_TYPES = [
  "ENGINEER",
  "DESIGNER",
  "ARCHITECT",
  "QA",
  "SPECIALIST",
] as const;

export type ProjectRoleType = (typeof PROJECT_ROLE_TYPES)[number];

/** Human-readable labels for each role type. */
export const PROJECT_ROLE_TYPE_LABELS: Record<ProjectRoleType, string> = {
  ENGINEER: "Engineer",
  DESIGNER: "Designer",
  ARCHITECT: "Architect",
  QA: "QA",
  SPECIALIST: "Specialist",
};

/**
 * The `staff_employment.role` a project role type corresponds to, used to cost an
 * OPEN (unstaffed) role from the company-wide average for that discipline.
 *
 * Four map 1:1. `SPECIALIST` deliberately has no counterpart — it's the catch-all
 * discipline, so `null` means "no single staff role to average" and the caller
 * falls back to every billable discipline (see `getRoleTypeAverageCostsUsd`).
 * The two enums are otherwise unrelated: `role` spans the whole company
 * (including overhead), while a project role type is a delivery discipline only.
 */
export const STAFF_ROLE_FOR_PROJECT_ROLE_TYPE: Record<
  ProjectRoleType,
  Role | null
> = {
  ENGINEER: "ENGINEER",
  DESIGNER: "DESIGNER",
  ARCHITECT: "ARCHITECT",
  QA: "QA",
  SPECIALIST: null,
};
