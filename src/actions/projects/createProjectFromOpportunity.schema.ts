import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import { projectBudgetSchema } from "./projectBudget.schema";

/**
 * Validation for creating a project directly from an opportunity. The project
 * inherits its name and company from the opportunity, so the only things the form
 * asks for are which opportunity to build from and how the work bills. A pure,
 * client-importable module so the create dialog and the server action share one
 * schema.
 */
export const createProjectFromOpportunitySchema = z.object({
  opportunityId: id,
  // Required, exactly as in `createProject` — a project born from a deal states
  // how it bills like any other. See `projectBudget.schema.ts`.
  budget: projectBudgetSchema,
});

export type CreateProjectFromOpportunityInput = z.input<
  typeof createProjectFromOpportunitySchema
>;
