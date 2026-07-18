import { z } from "zod";
import { id } from "@/lib/id-schema";
import {
  opportunityBaseFields,
  refineReferral,
} from "./createOpportunity.schema";

/**
 * Field-scoped edit of a single opportunity attribute from the detail drawer.
 *
 * A discriminated union on `field`: each variant carries only the slice that
 * field owns, so a drawer edit writes just what changed instead of re-sending
 * the whole record (which last-write-wins clobbers a concurrent edit and
 * needlessly rewrites every people junction). Mirrors the rationale behind
 * `updateContactOwner` — a narrow write that skips unrelated re-validation.
 *
 * Every field validator is reused verbatim from `opportunityBaseFields` (shared
 * with create + full-update, so the shapes can't drift). `source` carries its
 * referral entities together because the referral rule (`refineReferral`) spans
 * all three — applied at the union level, guarded to the `source` variant.
 * A pure, client-importable module so the drawer and the action share one schema.
 */
const {
  name,
  companyId,
  lineOfBusiness,
  nextSteps,
  status,
  contactIds,
  ownerIds,
  source,
  sourceContactIds,
  sourceStaffIds,
} = opportunityBaseFields;

export const updateOpportunityFieldSchema = z
  .discriminatedUnion("field", [
    z.object({ field: z.literal("name"), id, name }),
    z.object({ field: z.literal("companyId"), id, companyId }),
    z.object({ field: z.literal("lineOfBusiness"), id, lineOfBusiness }),
    z.object({ field: z.literal("nextSteps"), id, nextSteps }),
    z.object({ field: z.literal("status"), id, status }),
    z.object({ field: z.literal("contacts"), id, contactIds }),
    z.object({ field: z.literal("owners"), id, ownerIds }),
    z.object({
      field: z.literal("source"),
      id,
      source,
      sourceContactIds,
      sourceStaffIds,
    }),
  ])
  .superRefine((val, ctx) => {
    // The referral rule only applies to the source edit, which carries the
    // referral entities. Shared verbatim with create/full-update.
    if (val.field === "source") refineReferral(val, ctx);
  });

export type UpdateOpportunityFieldInput = z.input<
  typeof updateOpportunityFieldSchema
>;
