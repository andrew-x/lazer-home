import { z } from "zod";
import { idList } from "@/lib/id-schema";
import { LINE_OF_BUSINESS } from "@/lib/line-of-business";
import { OPPORTUNITY_SOURCES, OPPORTUNITY_STATUSES } from "@/lib/opportunity";
import { optionalText } from "@/lib/text-schema";

// The pipeline enums (and their types) live in `@/lib/opportunity` — a pure,
// client-importable module owned below the actions layer, so the pgEnum, the
// zod below, and the UI all derive from one source. Re-exported here for the
// existing importers that reach for them via this schema module.
export {
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STATUSES,
  type OpportunitySource,
  type OpportunityStatus,
} from "@/lib/opportunity";

/**
 * The field shape shared by create and update. Both build a `z.object` from
 * these fields (create adds `companyId`, update adds `id`) then apply
 * `refineReferral`, so the two schemas can't drift.
 */
export const opportunityBaseFields = {
  name: z.string().trim().min(1, "Name is required.").max(200),
  lineOfBusiness: z.enum(LINE_OF_BUSINESS),
  contactIds: idList,
  ownerIds: idList,
  source: z.enum(OPPORTUNITY_SOURCES),
  sourceContactIds: idList,
  sourceStaffIds: idList,
  // Empty/whitespace → null; otherwise trimmed.
  nextSteps: optionalText(2000),
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
    // Company is required — every opportunity belongs to a company.
    companyId: z.string().min(1, "Company is required."),
  })
  .superRefine(refineReferral);

export type CreateOpportunityInput = z.input<typeof createOpportunitySchema>;
