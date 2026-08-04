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

// Keep DELIVERY last. `ALTER TYPE ... ADD VALUE` appends to the pgEnum's sort order,
// so appending here keeps this tuple and the database agreeing on ordering — which
// matters wherever a UI iterates the tuple to render rows in "canonical" order.
export const PROJECT_ROLE_TYPES = [
  "ENGINEER",
  "DESIGNER",
  "ARCHITECT",
  "QA",
  "SPECIALIST",
  "DELIVERY",
] as const;

export type ProjectRoleType = (typeof PROJECT_ROLE_TYPES)[number];

/** Human-readable labels for each role type. */
export const PROJECT_ROLE_TYPE_LABELS: Record<ProjectRoleType, string> = {
  ENGINEER: "Engineer",
  DESIGNER: "Designer",
  ARCHITECT: "Architect",
  QA: "QA",
  SPECIALIST: "Specialist",
  DELIVERY: "Delivery",
};

/**
 * The `staff_employment.role` a project role type corresponds to, used to cost an
 * OPEN (unstaffed) role from the company-wide average for that discipline.
 *
 * Five map 1:1. `SPECIALIST` deliberately has no counterpart — it's the catch-all
 * discipline, so `null` means "no single staff role to average" and the caller
 * falls back to every billable discipline (see `getRoleTypeAverageCostsUsd`).
 * The two enums are otherwise unrelated: `role` spans the whole company
 * (including overhead), while a project role type is a delivery discipline only.
 *
 * `DELIVERY` maps 1:1 like the rest. Note that a *delivery role on a plan* — billable
 * time, dated, rated — is a different thing from `project_delivery_managers`, which
 * names who owns the engagement and carries no dates, hours or money. One person can
 * be both.
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
  DELIVERY: "DELIVERY",
};
