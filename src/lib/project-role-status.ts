/**
 * A project role's planning status. Declared here as a pure, client-importable
 * module (no `db`/drizzle) so the `projectRoleStatusEnum` pgEnum in
 * `projects-schema.ts`, zod schemas, and client forms all share exactly one
 * source of truth — the same single-source pattern as `project-status.ts` and
 * `project-role-type.ts`.
 *
 * A role is `tentative` while it's being planned against an opportunity
 * (editable in the opportunity's planner) and flips to `confirmed` when that
 * opportunity is marked Closed-Won — locked in and read-only. See
 * docs/domains/projects.md.
 */
export const PROJECT_ROLE_STATUSES = ["tentative", "confirmed"] as const;

export type ProjectRoleStatus = (typeof PROJECT_ROLE_STATUSES)[number];

/** The status a role is created with by default. */
export const DEFAULT_PROJECT_ROLE_STATUS: ProjectRoleStatus = "tentative";

/** Human-readable labels for each role status. */
export const PROJECT_ROLE_STATUS_LABELS: Record<ProjectRoleStatus, string> = {
  tentative: "Tentative",
  confirmed: "Confirmed",
};
