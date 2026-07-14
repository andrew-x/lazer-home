import { z } from "zod";
import { dateString } from "@/lib/date-schema";
import { idList, optionalId } from "@/lib/id-schema";
import { LINE_OF_BUSINESS } from "@/lib/line-of-business";
import { PROJECT_ROLE_TYPES } from "@/lib/project-role-type";
import { DEFAULT_PROJECT_STATUS, PROJECT_STATUSES } from "@/lib/project-status";
import { optionalText } from "@/lib/text-schema";

/**
 * Validation for creating a project. A pure, client-importable module (no
 * `db`/drizzle) so the create form's resolver and the server action share one
 * schema. Line-of-business values come from `@/lib/line-of-business` and role
 * types from `@/lib/project-role-type` — the same sources the pgEnums are built
 * from. Line of business is a project-level field (not per-role). See
 * docs/domains/projects.md.
 */

/**
 * A single staffing line on a project. `staffId` is optional — a role can be a
 * *placeholder* (an open position defined before it's staffed), identified by
 * its `roleType` and optional `name`. Dates and hours are always required. Line
 * of business lives on the project, not the role.
 */
export const projectRoleSchema = z
  .object({
    // Optional: absent ⇒ placeholder/open position.
    staffId: optionalId,
    // Optional label, e.g. "Senior Backend Engineer".
    name: optionalText(200),
    roleType: z.enum(PROJECT_ROLE_TYPES),
    startDate: dateString,
    endDate: dateString,
    // Daily hours; allows half-days. Defaults to a full 8-hour day.
    hoursPerDay: z.coerce
      .number()
      .positive("Enter hours greater than 0.")
      .max(24, "A day has at most 24 hours.")
      .default(8),
  })
  .refine((role) => role.endDate >= role.startDate, {
    path: ["endDate"],
    message: "End date must be on or after the start date.",
  });

export type ProjectRoleInput = z.input<typeof projectRoleSchema>;

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  // Every project belongs to a company.
  companyId: z.string().min(1, "Company is required."),
  // The project's line of business. Defaults to the originating opportunity's
  // when created from one (handled in the form).
  lineOfBusiness: z.enum(LINE_OF_BUSINESS),
  // Lifecycle status at creation. Defaults to `tentative`; the form pre-selects
  // it but a project can be created already-confirmed (etc.).
  status: z.enum(PROJECT_STATUSES).default(DEFAULT_PROJECT_STATUS),
  // Optional CRM opportunity this project delivers.
  opportunityId: optionalId,
  deliveryManagerIds: idList,
  // A project must be staffed with at least one role at creation.
  roles: z.array(projectRoleSchema).min(1, "Add at least one role."),
});

export type CreateProjectInput = z.input<typeof createProjectSchema>;
