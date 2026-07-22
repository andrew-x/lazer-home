import { z } from "zod";
import { LINE_OF_BUSINESS } from "@/lib/crm/line-of-business";
import { PROJECT_ROLE_TYPES } from "@/lib/projects/project-role-type";
import { dateString } from "@/lib/schemas/date-schema";
import { optionalId } from "@/lib/schemas/id-schema";
import { optionalText } from "@/lib/schemas/text-schema";

/**
 * The editable fields common to every project role — the per-role rows of
 * `createProject`, the standalone `createProjectRole`, and `updateProjectRole`
 * all share this shape so the field rules (optional staff ⇒ placeholder,
 * required dates/hours, coerced hours ≤ 24) live in exactly one place. A pure,
 * client-importable module. `status` and `opportunityId` are **server-controlled
 * provenance**, never user input; line of business lives on the role (a
 * project's LoBs are derived from its roles), defaulting from the opportunity.
 */
export const projectRoleFields = {
  // Optional: absent ⇒ placeholder/open position.
  staffId: optionalId,
  // The role's line of business. A project's set of lines of business is derived
  // from its roles; from an opportunity's planner this defaults to the
  // opportunity's line of business.
  lineOfBusiness: z.enum(LINE_OF_BUSINESS),
  // Optional free-text description, e.g. "Senior Backend Engineer".
  description: optionalText(200),
  roleType: z.enum(PROJECT_ROLE_TYPES),
  startDate: dateString,
  endDate: dateString,
  // Daily hours; allows half-days. Defaults to a full 8-hour day.
  hoursPerDay: z.coerce
    .number()
    .positive("Enter hours greater than 0.")
    .max(24, "A day has at most 24 hours.")
    .default(8),
} as const;

/** Shared `endDate >= startDate` refinement (predicate + message), so every
 * role schema reports the same rule on the same path. */
export const endOnOrAfterStart = (role: {
  startDate: string;
  endDate: string;
}) => role.endDate >= role.startDate;

export const endOnOrAfterStartError = {
  path: ["endDate"],
  message: "End date must be on or after the start date.",
};

/** A single staffing line as validated in the create-project roles array. */
export const projectRoleSchema = z
  .object(projectRoleFields)
  .refine(endOnOrAfterStart, endOnOrAfterStartError);

export type ProjectRoleInput = z.input<typeof projectRoleSchema>;
