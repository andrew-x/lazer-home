import { z } from "zod";
import { dateString } from "@/lib/date-schema";
import { id } from "@/lib/id-schema";
import {
  endOnOrAfterStart,
  endOnOrAfterStartError,
  projectRoleFields,
} from "./projectRole.schema";

/**
 * Extend an existing role: add a new tentative segment sharing a source role's
 * staff/type/name (e.g. the same person's allocation continued by this
 * opportunity). The source role may be any role on the opportunity's project —
 * including a confirmed one from an earlier deal (that's the point of an
 * extension). Only the new segment's date range and hours are supplied.
 */
export const extendProjectRoleSchema = z
  .object({
    sourceRoleId: id,
    opportunityId: id,
    startDate: dateString,
    endDate: dateString,
    hoursPerDay: projectRoleFields.hoursPerDay,
  })
  .refine(endOnOrAfterStart, endOnOrAfterStartError);

export type ExtendProjectRoleInput = z.input<typeof extendProjectRoleSchema>;
