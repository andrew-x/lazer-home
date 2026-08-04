import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";

/**
 * A project's name rule, shared with `updateProjectField`'s `name` variant so the
 * planner dialog and the detail page's inline field can't drift apart.
 */
export const projectName = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(200);

/**
 * Validation for renaming a project from the planner's Edit dialog. A pure,
 * client-importable module (no `db`/drizzle) so the edit form's resolver and the
 * server action share one schema. The name is the only editable top-level field: a
 * project's status, lines of business and delivery managers are all derived from its
 * roles, and roles are edited separately (per-role actions).
 */
export const updateProjectSchema = z.object({
  projectId: id,
  name: projectName,
});

export type UpdateProjectInput = z.input<typeof updateProjectSchema>;
