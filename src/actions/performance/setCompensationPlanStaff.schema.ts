// Client-imported: `manage-plan-staff.tsx` calls this with the full checked set,
// so it must stay drizzle-free hand-written zod (ADR 0035).
import { z } from "zod";
import { id, idList } from "@/lib/schemas/id-schema";

/**
 * The complete membership of a plan — every staff member who should be in it,
 * not a delta. The action diffs against what's stored, so the client never has
 * to track adds and removes separately (and two people reconciling at once
 * can't produce a half-applied set).
 *
 * An empty list is legal: it means "remove everyone".
 */
export const setCompensationPlanStaffSchema = z.object({
  planId: id,
  staffIds: idList,
});

export type SetCompensationPlanStaffInput = z.infer<
  typeof setCompensationPlanStaffSchema
>;
