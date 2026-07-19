import { z } from "zod";
import { id } from "@/lib/id-schema";
import {
  endOnOrAfterStart,
  endOnOrAfterStartError,
  projectRoleFields,
} from "./projectRole.schema";

/**
 * Edit a tentative role from an opportunity's planner. `opportunityId` is the
 * current planner context — the role must be tentative and tagged with it
 * (enforced by `assertRoleEditable`). `status`/`opportunityId` on the role are
 * never rewritten here.
 */
export const updateProjectRoleSchema = z
  .object({
    id,
    opportunityId: id,
    ...projectRoleFields,
  })
  .refine(endOnOrAfterStart, endOnOrAfterStartError);

export type UpdateProjectRoleInput = z.input<typeof updateProjectRoleSchema>;
