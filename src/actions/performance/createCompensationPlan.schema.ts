// Client-imported: `new-plan-dialog.tsx` uses this as its zodResolver, so it must
// stay drizzle-free hand-written zod (ADR 0035).
import { z } from "zod";
import { dateString } from "@/lib/schemas/date-schema";
import { idList } from "@/lib/schemas/id-schema";
import { requiredText } from "@/lib/schemas/text-schema";

export const PLAN_NAME_MAX = 120;

/**
 * A new compensation plan. `staffIds` may be empty — the editor opens its staff
 * picker automatically for an empty plan, so creating first and populating
 * second is the normal path rather than an error case.
 */
export const createCompensationPlanSchema = z.object({
  name: requiredText(PLAN_NAME_MAX, "Give the plan a name."),
  effectiveDate: dateString,
  staffIds: idList,
});

export type CreateCompensationPlanInput = z.infer<
  typeof createCompensationPlanSchema
>;
