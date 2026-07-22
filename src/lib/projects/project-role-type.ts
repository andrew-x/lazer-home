/**
 * The role types (disciplines) a project staffing line can be. Declared here as a
 * pure, client-importable module (no `db`/drizzle) so the `projectRoleTypeEnum`
 * pgEnum in `projects-schema.ts`, the zod enum in `createProject.schema.ts`, and
 * the create-project form all share exactly one source of truth — mirrors
 * `@/lib/crm/line-of-business`. A role's type is its discipline (what kind of work);
 * it's orthogonal to line of business (which practice bills it). See
 * docs/domains/projects.md.
 */
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
