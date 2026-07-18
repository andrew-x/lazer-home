import { z } from "zod";
import { id, idList } from "@/lib/id-schema";
import { LINE_OF_BUSINESS } from "@/lib/line-of-business";
import { PROJECT_STATUSES } from "@/lib/project-status";

/**
 * Validation for editing a project's top-level fields from the planner (name,
 * line of business, status, delivery managers). A pure, client-importable module
 * (no `db`/drizzle) so the edit form's resolver and the server action share one
 * schema. Roles are edited separately (per-role actions), not here.
 */
export const updateProjectSchema = z.object({
  projectId: id,
  name: z.string().trim().min(1, "Name is required.").max(200),
  lineOfBusiness: z.enum(LINE_OF_BUSINESS),
  status: z.enum(PROJECT_STATUSES),
  deliveryManagerIds: idList,
});

export type UpdateProjectInput = z.input<typeof updateProjectSchema>;
