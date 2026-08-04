import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import {
  endOnOrAfterStart,
  endOnOrAfterStartError,
  projectRoleFields,
  snapshotBillRate,
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
  .refine(endOnOrAfterStart, endOnOrAfterStartError)
  .transform(snapshotBillRate);

export type UpdateProjectRoleInput = z.input<typeof updateProjectRoleSchema>;
