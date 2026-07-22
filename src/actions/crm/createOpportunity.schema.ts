import { z } from "zod";
import { LINE_OF_BUSINESS } from "@/lib/crm/line-of-business";
import {
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STATUSES,
} from "@/lib/crm/opportunity";
import { idList } from "@/lib/schemas/id-schema";

/**
 * The field shape shared by create and update. Both build a `z.object` from
 * these fields (update adds `id`) then apply `refineReferral`, so the two
 * schemas can't drift. Company is included here since both flows edit it.
 */
export const opportunityBaseFields = {
  name: z.string().trim().min(1, "Name is required.").max(200),
  // Company is required — every opportunity belongs to a company.
  companyId: z.string().min(1, "Company is required."),
  lineOfBusiness: z.enum(LINE_OF_BUSINESS),
  contactIds: idList,
  ownerIds: idList,
  source: z.enum(OPPORTUNITY_SOURCES),
  sourceContactIds: idList,
  sourceStaffIds: idList,
  status: z.enum(OPPORTUNITY_STATUSES),
};

/**
 * The conditional referral rule shared by create and update: a staff-referral
 * must name at least one referring staff member; a contact-referral at least
 * one referring contact. Passed to `.superRefine` on both schemas.
 */
export function refineReferral(
  val: {
    source: (typeof OPPORTUNITY_SOURCES)[number];
    sourceStaffIds: string[];
    sourceContactIds: string[];
  },
  ctx: z.RefinementCtx,
) {
  if (val.source === "staff_referral" && val.sourceStaffIds.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["sourceStaffIds"],
      message: "Add at least one referring staff member.",
    });
  }
  if (val.source === "contact_referral" && val.sourceContactIds.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["sourceContactIds"],
      message: "Add at least one referring contact.",
    });
  }
}

export const createOpportunitySchema = z
  .object({
    ...opportunityBaseFields,
  })
  .superRefine(refineReferral);

export type CreateOpportunityInput = z.input<typeof createOpportunitySchema>;
