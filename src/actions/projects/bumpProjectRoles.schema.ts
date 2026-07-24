import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";

/**
 * Bulk-shift tentative roles in an opportunity's planner by whole weeks — both
 * start and end move, preserving each role's duration. `weeks` may be negative
 * to pull work earlier. Every id must be tentative and tagged with
 * `opportunityId` (enforced per id by `assertRoleEditable`). A pure,
 * client-importable module.
 */
export const bumpProjectRolesSchema = z.object({
  opportunityId: id,
  roleIds: z.array(id).min(1),
  weeks: z.coerce
    .number()
    .int("Enter a whole number of weeks.")
    .refine((n) => n !== 0, "Enter a non-zero number of weeks."),
});

export type BumpProjectRolesInput = z.input<typeof bumpProjectRolesSchema>;
