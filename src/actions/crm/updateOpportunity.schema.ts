import { z } from "zod";
import { id } from "@/lib/id-schema";
import {
  opportunityBaseFields,
  refineReferral,
} from "./createOpportunity.schema";

/**
 * Validation for editing an opportunity from the detail drawer. Shares
 * `opportunityBaseFields` and `refineReferral` with `createOpportunitySchema`
 * (so the field shape and the source-referral rules can't drift) but targets an
 * existing row by `id` and omits the company — the company isn't editable in the
 * drawer. A pure, client-importable module so the drawer form and the action
 * share one schema. See docs/domains/crm.md.
 */
export const updateOpportunitySchema = z
  .object({
    ...opportunityBaseFields,
    id,
  })
  .superRefine(refineReferral);

export type UpdateOpportunityInput = z.input<typeof updateOpportunitySchema>;
