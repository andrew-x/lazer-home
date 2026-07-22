import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";

/**
 * Remove a tentative role from an opportunity's planner. `opportunityId` is the
 * planner context — the role must be tentative and tagged with it (enforced by
 * `assertRoleEditable`).
 */
export const deleteProjectRoleSchema = z.object({
  id,
  opportunityId: id,
});

export type DeleteProjectRoleInput = z.input<typeof deleteProjectRoleSchema>;
