import { z } from "zod";
import { normalizedPtoSchema } from "@/lib/staff/pto-import/types";

/** Shared input for both preview and commit: the transformed CSV rows. */
export const ptoImportInputSchema = z.object({
  rows: z.array(normalizedPtoSchema),
});

export type PtoImportInput = z.infer<typeof ptoImportInputSchema>;
