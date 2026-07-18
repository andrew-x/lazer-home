import { z } from "zod";
import { idList, optionalId } from "@/lib/id-schema";
import { LINE_OF_BUSINESS } from "@/lib/line-of-business";
import { DEFAULT_PROJECT_STATUS, PROJECT_STATUSES } from "@/lib/project-status";
import { projectRoleSchema } from "./projectRole.schema";

/**
 * Validation for creating a project. A pure, client-importable module (no
 * `db`/drizzle) so the create form's resolver and the server action share one
 * schema. Line-of-business values come from `@/lib/line-of-business`; the
 * per-role rules live in the shared `projectRole.schema`. Line of business is a
 * project-level field (not per-role). See docs/domains/projects.md.
 */

// Re-export so existing importers (the create-project form) keep one import site.
export { type ProjectRoleInput, projectRoleSchema } from "./projectRole.schema";

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  // Every project belongs to a company.
  companyId: z.string().min(1, "Company is required."),
  // The project's line of business. Defaults to the originating opportunity's
  // when created from one (handled in the form).
  lineOfBusiness: z.enum(LINE_OF_BUSINESS),
  // Lifecycle status at creation. Defaults to `tentative`; the form pre-selects
  // it but a project can be created already-confirmed (etc.).
  status: z.enum(PROJECT_STATUSES).default(DEFAULT_PROJECT_STATUS),
  // Optional CRM opportunity this project delivers.
  opportunityId: optionalId,
  deliveryManagerIds: idList,
  // A project must be staffed with at least one role at creation.
  roles: z.array(projectRoleSchema).min(1, "Add at least one role."),
});

export type CreateProjectInput = z.input<typeof createProjectSchema>;
