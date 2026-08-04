import { z } from "zod";
import {
  LINE_OF_BUSINESS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import { billRateFor } from "@/lib/projects/bill-rates";
import {
  PROJECT_ROLE_TYPES,
  type ProjectRoleType,
} from "@/lib/projects/project-role-type";
import { dateString } from "@/lib/schemas/date-schema";
import { optionalId } from "@/lib/schemas/id-schema";
import { optionalMoney } from "@/lib/schemas/money-schema";
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
  // The hourly bill rate for this line. OPTIONAL on input and filled by
  // `snapshotBillRate` below — unlike `hoursPerDay` it can't use `.default()`,
  // because its default depends on two sibling fields (line of business and role
  // type) rather than being a constant. A blank field therefore means "use today's
  // rate card", which is also how a stale rate gets reset.
  billRate: optionalMoney({
    positive: "Enter a bill rate greater than 0.",
    max: "That rate is too large.",
  }),
} as const;

/**
 * Fill an absent `billRate` from the rate card, so every parsed role carries a
 * concrete rate and `project_roles.billRate` (NOT NULL) can never be missed.
 *
 * Applied as a schema transform rather than as a `??` in each action body on purpose:
 * there are five insert paths and two update paths, the column has no DB default, and
 * a single forgotten fallback would be a 500 rather than a silently wrong row. Doing it
 * here makes `billRate` a plain `number` in every schema's *output* type, so the type
 * checker does the remembering. The same "one rule, every role schema" reasoning as
 * {@link endOnOrAfterStart}.
 *
 * Note this is where the *snapshot* is taken: the resulting rate is a recorded fact
 * about this role, not a live reference to the card. A later card revision does not
 * revisit it (ADR 0066).
 *
 * Caveat for anyone adding a partial/patch update later (the `saveCompensationPlanItem`
 * pattern): both role update schemas are full-object writes, so an absent `billRate`
 * unambiguously means "re-snapshot". Under a partial patch it would silently re-price a
 * role whose rate the caller simply didn't send.
 */
export const snapshotBillRate = <
  T extends {
    lineOfBusiness: LineOfBusiness;
    roleType: ProjectRoleType;
    billRate?: number;
  },
>(
  role: T,
): Omit<T, "billRate"> & { billRate: number } => ({
  ...role,
  billRate: role.billRate ?? billRateFor(role),
});

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
  .refine(endOnOrAfterStart, endOnOrAfterStartError)
  .transform(snapshotBillRate);

export type ProjectRoleInput = z.input<typeof projectRoleSchema>;
