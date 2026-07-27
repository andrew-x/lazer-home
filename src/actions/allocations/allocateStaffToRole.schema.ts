import { z } from "zod";
import {
  endOnOrAfterStart,
  endOnOrAfterStartError,
} from "@/actions/projects/projectRole.schema";
import { dateString } from "@/lib/schemas/date-schema";
import { id } from "@/lib/schemas/id-schema";

/**
 * Input for allocating a person to an existing **open** project role from the
 * allocations view: which role, who fills it, and the date range + hours/day to
 * apply (the dialog prefills these from the role, then lets the user adjust).
 *
 * A pure, client-importable module (no `db`/drizzle) — the allocate dialog
 * imports it for the form resolver. Reuses the shared `endDate >= startDate`
 * refinement and the same hours rule as `projectRoleFields`.
 */
export const allocateStaffToRoleSchema = z
  .object({
    roleId: id,
    staffId: id,
    startDate: dateString,
    endDate: dateString,
    hoursPerDay: z.coerce
      .number()
      .positive("Enter hours greater than 0.")
      .max(24, "A day has at most 24 hours."),
  })
  .refine(endOnOrAfterStart, endOnOrAfterStartError);

export type AllocateStaffToRoleInput = z.infer<
  typeof allocateStaffToRoleSchema
>;
