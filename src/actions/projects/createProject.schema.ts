import { z } from "zod";
import { idList, optionalId } from "@/lib/schemas/id-schema";
import { projectBudgetSchema } from "./projectBudget.schema";
import { projectRoleSchema } from "./projectRole.schema";

/**
 * Validation for creating a standalone project. A pure, client-importable module
 * (no `db`/drizzle) so the create form's resolver and the server action share one
 * schema. A project has no line of business or status of its own — both are
 * derived from its roles (see `project-derived.ts`); the per-role rules (incl.
 * each role's line of business) live in the shared `projectRole.schema`. Projects
 * created from an opportunity use `createProjectFromOpportunity` instead, which
 * inherits name + company from the deal but collects the same budget.
 * See docs/domains/projects.md.
 */

// Re-export so existing importers (the create-project form) keep one import site.
export { type ProjectRoleInput, projectRoleSchema } from "./projectRole.schema";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  // Every project belongs to a company.
  companyId: z.string().min(1, "Company is required."),
  // Optional CRM opportunity this project delivers.
  opportunityId: optionalId,
  deliveryManagerIds: idList,
  // Roles and delivery managers are optional at creation — the create form
  // collects only name + company + budget, and they're added afterward in the
  // project planner. Defaults to none.
  roles: z.array(projectRoleSchema).default([]),
  // Required: every project created from here on states how it bills. Projects
  // that predate budgets have none — those columns are nullable and the UI reads
  // that as "No budget set". Nested under one key rather than intersected in, so
  // the form's `Record<keyof CreateProjectInput, IssueTarget>` error map stays
  // exhaustive with a single new entry.
  budget: projectBudgetSchema,
});

export type CreateProjectInput = z.input<typeof createProjectSchema>;
