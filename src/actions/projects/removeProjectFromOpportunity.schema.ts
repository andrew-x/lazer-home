import { z } from "zod";
import { id } from "@/lib/id-schema";

/**
 * Validation for removing an opportunity's project from its planner. The only
 * input is the opportunity; the target project is derived from its `projectId`.
 * Whether this deletes the project or just detaches it depends on ownership (see
 * `detachProjectFromOpportunity`).
 */
export const removeProjectFromOpportunitySchema = z.object({
  opportunityId: id,
});

export type RemoveProjectFromOpportunityInput = z.input<
  typeof removeProjectFromOpportunitySchema
>;
