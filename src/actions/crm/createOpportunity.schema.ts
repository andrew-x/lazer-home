import { z } from "zod";
import { idList } from "@/lib/id-schema";
import { LINE_OF_BUSINESS } from "@/lib/line-of-business";
import { optionalText } from "@/lib/text-schema";

/**
 * The opportunity pipeline enums. Declared here (a pure, client-importable
 * module — no `db`/drizzle) so the pgEnum in `opportunities-schema.ts` and the
 * zod enum below share exactly one source of truth. See docs/domains/crm.md.
 */
export const OPPORTUNITY_SOURCES = [
  "inbound",
  "farming",
  "extension",
  "change_request",
  "staff_referral",
  "contact_referral",
] as const;

/**
 * The pipeline stages, as flat leaf statuses in strict pipeline order. Array
 * index === pipeline position — both the pgEnum and the group structure in
 * `@/lib/opportunity-pipeline` derive from this order, so keep them ordered.
 * Grouping (Scoping/Allocating/Closing hold several substatuses; the rest are
 * single-status groups) lives in `opportunity-pipeline.ts`.
 */
export const OPPORTUNITY_STATUSES = [
  "maturing",
  "lead",
  "qualifying",
  "scoping_awaiting_info",
  "scoping",
  "scoping_reviewing",
  "allocating_awaiting_profiles",
  "allocating_introing_profiles",
  "negotiating",
  "closing_awaiting_contracts",
  "closing_redlining",
  "closing_awaiting_signatures",
  "closed_won",
  "closed_lost",
] as const;

export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number];
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const createOpportunitySchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(200),
    // Company is required — every opportunity belongs to a company.
    companyId: z.string().min(1, "Company is required."),
    lineOfBusiness: z.enum(LINE_OF_BUSINESS),
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

export type CreateOpportunityInput = z.input<typeof createOpportunitySchema>;
