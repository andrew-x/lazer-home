import { z } from "zod";
import { id } from "@/lib/id-schema";

/**
 * Validation for deleting an opportunity. A pure, client-importable module so the
 * delete trigger and the server action share one schema.
 */
export const deleteOpportunitySchema = z.object({
  id,
});

export type DeleteOpportunityInput = z.input<typeof deleteOpportunitySchema>;
