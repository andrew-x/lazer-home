import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";

/**
 * Bulk-duplicate tentative roles in an opportunity's planner. The copies are
 * new tentative roles for this opportunity **without** the assigned staff (open
 * positions). Every source id must be tentative and tagged with `opportunityId`
 * (enforced per id by `assertRoleEditable`). A pure, client-importable module.
 */
export const duplicateProjectRolesSchema = z.object({
  opportunityId: id,
  roleIds: z.array(id).min(1),
});

export type DuplicateProjectRolesInput = z.input<
  typeof duplicateProjectRolesSchema
>;
