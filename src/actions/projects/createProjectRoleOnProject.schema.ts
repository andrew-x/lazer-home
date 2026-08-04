import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import {
  endOnOrAfterStart,
  endOnOrAfterStartError,
  projectRoleFields,
  snapshotBillRate,
} from "./projectRole.schema";

/**
 * Add one role directly to a project, from the project detail page. The
 * project-keyed counterpart of `createProjectRoleSchema` (which derives its
 * project from an opportunity). `status` and the role's `opportunityId` tag are
 * server-controlled, not part of this input — a role added here belongs to the
 * project rather than to any deal, so it carries no opportunity.
 */
export const createProjectRoleOnProjectSchema = z
  .object({
    projectId: id,
    ...projectRoleFields,
  })
  .refine(endOnOrAfterStart, endOnOrAfterStartError)
  .transform(snapshotBillRate);

export type CreateProjectRoleOnProjectInput = z.input<
  typeof createProjectRoleOnProjectSchema
>;
