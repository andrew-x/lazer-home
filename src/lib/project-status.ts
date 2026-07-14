/**
 * The project lifecycle status. Declared here as a pure, client-importable
 * module (no `db`/drizzle) so the `projectStatusEnum` pgEnum in
 * `projects-schema.ts`, zod schemas, and client forms all share exactly one
 * source of truth. A project starts `tentative` and moves through the pipeline
 * as delivery firms up. See docs/domains/projects.md.
 */
export const PROJECT_STATUSES = [
  "tentative",
  "confirmed",
  "paused",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** The status a project is created with by default. */
export const DEFAULT_PROJECT_STATUS: ProjectStatus = "tentative";

/** Human-readable labels for each project status. */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  tentative: "Tentative",
  confirmed: "Confirmed",
  paused: "Paused",
  cancelled: "Cancelled",
};
