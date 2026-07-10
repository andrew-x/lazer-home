import { z } from "zod";
import { idList } from "@/lib/id-schema";
import { optionalText } from "@/lib/text-schema";
import {
  OPPORTUNITY_SOURCES,
  OPPORTUNITY_STATUSES,
} from "./createOpportunity.schema";

/**
 * Validation for editing an opportunity from the detail drawer. Mirrors
 * `createOpportunitySchema` (same enums, `idList`, and the conditional
 * source-referral rules) but targets an existing row by `id` and omits the
 * company — the company isn't editable in the drawer. A pure, client-importable
 * module so the drawer form and the action share one schema. See docs/domains/crm.md.
 */
export const updateOpportunitySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1, "Name is required.").max(200),
    contactIds: idList,
    ownerIds: idList,
    source: z.enum(OPPORTUNITY_SOURCES),
    sourceContactIds: idList,
    sourceStaffIds: idList,
    // Empty/whitespace → null; otherwise trimmed.
    nextSteps: optionalText(2000),
    status: z.enum(OPPORTUNITY_STATUSES),
  })
  .superRefine((val, ctx) => {
    // A staff-referral must name at least one referring staff member; a
    // contact-referral at least one referring contact.
    if (val.source === "staff_referral" && val.sourceStaffIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceStaffIds"],
        message: "Add at least one referring staff member.",
      });
    }
    if (
      val.source === "contact_referral" &&
      val.sourceContactIds.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceContactIds"],
        message: "Add at least one referring contact.",
      });
    }
  });

export type UpdateOpportunityInput = z.input<typeof updateOpportunitySchema>;
