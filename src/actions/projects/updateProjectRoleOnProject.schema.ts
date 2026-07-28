import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import {
  endOnOrAfterStart,
  endOnOrAfterStartError,
  projectRoleFields,
} from "./projectRole.schema";

/**
 * Edit a role from the project detail page. `projectId` is the current page's
 * project — the role must belong to it (enforced by `assertProjectRoleEditable`).
 * Unlike `updateProjectRoleSchema` there is no opportunity context and no
 * tentative-only restriction; see that guard for why. The role's
 * `status`/`opportunityId` are never rewritten here.
 */
export const updateProjectRoleOnProjectSchema = z
  .object({
    id,
    projectId: id,
    ...projectRoleFields,
  })
  .refine(endOnOrAfterStart, endOnOrAfterStartError);

export type UpdateProjectRoleOnProjectInput = z.input<
  typeof updateProjectRoleOnProjectSchema
>;
