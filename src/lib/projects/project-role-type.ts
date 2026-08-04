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

/**
 * Is this discipline the one that runs the engagement? Wherever a project's roles
 * are listed, the delivery line sorts first and carries a row tint — it is the
 * accountability line, not another staffing line, and a reader scanning a plan looks
 * for it first.
 *
 * Deliberately **not** `isDeliveryRole` from `@/lib/projects/delivery-coverage`,
 * which additionally requires the role to be live. The two answer different
 * questions: that one asks "does this cover the plan", where this asks "what kind of
 * line is this". A *cancelled* delivery role is still a delivery role and still
 * belongs at the top of the table, marked — it just covers nothing.
 */
export function isDeliveryDiscipline(roleType: ProjectRoleType): boolean {
  return roleType === "DELIVERY";
}

/**
 * The row tint marking a delivery line in a list of roles. Neutral, never coloured:
 * running the engagement is a *kind* of line, not a status and not a problem, so it
 * reads as "this row is structurally different" and spends none of the badge or
 * colour vocabulary those columns already give to status.
 *
 * Deeper than the by-project planner's `bg-muted/30` project-header rows on purpose.
 * Delivery sorts first, so a delivery subrow there always lands directly beneath a
 * header; at the *same* tint the two would read as one band, so this has to be a
 * clear step darker rather than a shade of it.
 *
 * **Every sticky column in a row has to repeat this.** The planner grids paint
 * `bg-background` on their sticky lead cells, so a tint set only on the `<tr>` gets
 * punched through wherever a column is pinned — see `planner-grid.tsx`, which has
 * two.
 */
export const DELIVERY_ROW_CLASS = "bg-muted/60";

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
 * `DELIVERY` maps 1:1 like the rest, and it is the *only* way a project names who
 * runs it: a delivery manager **is** a `DELIVERY` role — dated, priced and statused
 * like every other line — so a project's delivery managers are derived from its
 * roles rather than stored. There used to be a `project_delivery_managers` junction
 * alongside this; it carried no dates, so it could never say who ran an engagement
 * *in March*. See `@/lib/projects/delivery-coverage` (ADR 0068).
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
