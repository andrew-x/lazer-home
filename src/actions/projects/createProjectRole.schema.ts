import { z } from "zod";
import { id } from "@/lib/id-schema";
import {
  endOnOrAfterStart,
  endOnOrAfterStartError,
  projectRoleFields,
} from "./projectRole.schema";

/**
 * Add one tentative role to the project associated with `opportunityId`. The
 * target project is derived server-side from the opportunity's `projectId`
 * (a role always lands on the opportunity's own project). `status` and the
 * role's `opportunityId` tag are server-controlled, not part of this input.
 */
export const createProjectRoleSchema = z
  .object({
    opportunityId: id,
    ...projectRoleFields,
  })
  .refine(endOnOrAfterStart, endOnOrAfterStartError);

export type CreateProjectRoleInput = z.input<typeof createProjectRoleSchema>;
