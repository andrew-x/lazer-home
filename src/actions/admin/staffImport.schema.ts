import { z } from "zod";
import { normalizedStaffSchema } from "@/lib/staff/staff-import/types";

/** Shared input for both preview and commit: the transformed CSV rows. */
export const staffImportInputSchema = z.object({
  rows: z.array(normalizedStaffSchema),
});

export type StaffImportInput = z.infer<typeof staffImportInputSchema>;
