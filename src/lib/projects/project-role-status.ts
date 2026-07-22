/**
 * A project role's planning status. Declared here as a pure, client-importable
 * module (no `db`/drizzle) so the `projectRoleStatusEnum` pgEnum in
 * `projects-schema.ts`, zod schemas, and client forms all share exactly one
 * source of truth — the same single-source pattern as `project-role-type.ts`.
 *
 * A role is `tentative` while it's being planned against an opportunity
 * (editable in the opportunity's planner) and flips to `confirmed` when that
 * opportunity is marked Closed-Won — locked in and read-only. `paused` and
 * `cancelled` cover a role that's on hold or dropped. A project has no status of
 * its own: its status is *derived* from its roles (see `project-derived.ts`),
 * which is why the two lifecycle states that used to live on the project now
 * live here. See docs/domains/projects.md.
 */
export const PROJECT_ROLE_STATUSES = [
  "tentative",
  "confirmed",
  "paused",
  "cancelled",
] as const;

export type ProjectRoleStatus = (typeof PROJECT_ROLE_STATUSES)[number];

/** The status a role is created with by default. */
export const DEFAULT_PROJECT_ROLE_STATUS: ProjectRoleStatus = "tentative";

/** Human-readable labels for each role status. */
export const PROJECT_ROLE_STATUS_LABELS: Record<ProjectRoleStatus, string> = {
  tentative: "Tentative",
  confirmed: "Confirmed",
  paused: "Paused",
  cancelled: "Cancelled",
};

/**
 * Badge variant for each status. Confirmed reads as the primary (default) badge;
 * tentative stays muted; paused is outlined; cancelled reads as destructive.
 * Shared by the role status badge and the derived project status badge.
 */
export const PROJECT_ROLE_STATUS_VARIANTS: Record<
  ProjectRoleStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  confirmed: "default",
  tentative: "secondary",
  paused: "outline",
  cancelled: "destructive",
};
