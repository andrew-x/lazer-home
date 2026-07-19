import { z } from "zod";
import { id, idList } from "@/lib/id-schema";

/**
 * Validation for editing a project's top-level fields from the planner's Edit
 * dialog (name, delivery managers). A pure, client-importable module (no
 * `db`/drizzle) so the edit form's resolver and the server action share one
 * schema. A project has no status or line of business of its own (both are
 * derived from its roles); roles are edited separately (per-role actions).
 */
export const updateProjectSchema = z.object({
  projectId: id,
  name: z.string().trim().min(1, "Name is required.").max(200),
  deliveryManagerIds: idList,
});

export type UpdateProjectInput = z.input<typeof updateProjectSchema>;
