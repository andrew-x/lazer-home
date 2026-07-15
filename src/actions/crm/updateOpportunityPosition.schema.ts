import { z } from "zod";
import { OPPORTUNITY_STATUSES } from "@/lib/opportunity";

/**
 * Move an opportunity on the kanban board: its (possibly new) status column and
 * its new fractional `position` within that column. A within-column reorder
 * resends the unchanged status; a cross-column drag sends the resolved status.
 * Shared with the board client so it can type the `execute(...)` payload.
 */
export const updateOpportunityPositionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(OPPORTUNITY_STATUSES),
  position: z.number(),
});

export type UpdateOpportunityPositionInput = z.infer<
  typeof updateOpportunityPositionSchema
>;
