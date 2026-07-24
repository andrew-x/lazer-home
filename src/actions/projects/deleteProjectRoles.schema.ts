import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";

/**
 * Bulk-delete tentative roles from an opportunity's planner. Every id must be
 * tentative and tagged with `opportunityId` (enforced per id by
 * `assertRoleEditable`). A pure, client-importable module.
 */
export const deleteProjectRolesSchema = z.object({
  opportunityId: id,
  roleIds: z.array(id).min(1),
});

export type DeleteProjectRolesInput = z.input<typeof deleteProjectRolesSchema>;
