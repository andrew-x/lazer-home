import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import { projectBudgetSchema } from "./projectBudget.schema";

/**
 * Validation for re-pricing an existing project — the only way to give a
 * pre-budget project a budget, or to switch one between billing models. A pure,
 * client-importable module so the budget dialog's resolver and the server action
 * share one schema.
 */
export const updateProjectBudgetSchema = z.object({
  projectId: id,
  budget: projectBudgetSchema,
});

export type UpdateProjectBudgetInput = z.input<
  typeof updateProjectBudgetSchema
>;
