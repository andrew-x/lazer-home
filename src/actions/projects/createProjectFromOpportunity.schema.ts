import { z } from "zod";
import { id } from "@/lib/id-schema";

/**
 * Validation for creating a project directly from an opportunity. There's no
 * form — the project inherits its name and company from the opportunity — so the
 * only input is which opportunity to build from. A pure, client-importable module
 * so the one-click trigger and the server action share one schema.
 */
export const createProjectFromOpportunitySchema = z.object({
  opportunityId: id,
});

export type CreateProjectFromOpportunityInput = z.input<
  typeof createProjectFromOpportunitySchema
>;
