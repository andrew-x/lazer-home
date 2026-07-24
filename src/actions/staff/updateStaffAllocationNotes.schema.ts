import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import { optionalTrimmedText } from "@/lib/schemas/text-schema";

/**
 * Allocation-notes edit input — a pure, client-importable module (no
 * `db`/drizzle) so the planner's inline editor and the server action share one
 * schema. Empty (cleared) maps to null via the shared optional-trimmed-text
 * validator.
 */
export const updateStaffAllocationNotesSchema = z.object({
  staffId: id,
  allocationNotes: optionalTrimmedText(
    2000,
    "Keep notes under 2000 characters.",
  ),
});

export type UpdateStaffAllocationNotesInput = z.input<
  typeof updateStaffAllocationNotesSchema
>;
