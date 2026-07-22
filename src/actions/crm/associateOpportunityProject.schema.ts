import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";

/**
 * Link an opportunity to an existing project (the CRM → delivery association).
 * Shared, client-importable so the planner form and the action agree. Both ids
 * are required; the same-company invariant and the "not already linked" rule are
 * enforced server-side in the action.
 */
export const associateOpportunityProjectSchema = z.object({
  opportunityId: id,
  projectId: id,
});

export type AssociateOpportunityProjectInput = z.input<
  typeof associateOpportunityProjectSchema
>;
