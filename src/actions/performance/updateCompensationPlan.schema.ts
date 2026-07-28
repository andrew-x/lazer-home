// Client-imported: `edit-plan-dialog.tsx` uses this as its zodResolver, so it must
// stay drizzle-free hand-written zod (ADR 0035).
import { z } from "zod";
import { dateString } from "@/lib/schemas/date-schema";
import { id } from "@/lib/schemas/id-schema";
import { requiredText } from "@/lib/schemas/text-schema";
import { PLAN_NAME_MAX } from "./createCompensationPlan.schema";

export const updateCompensationPlanSchema = z.object({
  planId: id,
  name: requiredText(PLAN_NAME_MAX, "Give the plan a name."),
  effectiveDate: dateString,
});

export type UpdateCompensationPlanInput = z.infer<
  typeof updateCompensationPlanSchema
>;
