import { z } from "zod";
import { LINE_OF_BUSINESS } from "@/lib/line-of-business";

/**
 * Validation for creating a project. A pure, client-importable module (no
 * `db`/drizzle) so the create form's resolver and the server action share one
 * schema. Line-of-business values come from `@/lib/line-of-business` — the same
 * source the `lineOfBusinessEnum` pgEnum is built from. See docs/domains/projects.md.
 */

/** A calendar date as a timezone-agnostic "YYYY-MM-DD" string (DatePicker output). */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date.");

/** A list of related-staff ids, defaulting to empty. */
const idList = z.array(z.string().min(1)).default([]);

/** A single staffing line on a project. */
export const projectRoleSchema = z
  .object({
    staffId: z.string().min(1, "Staff is required."),
    lineOfBusiness: z.enum(LINE_OF_BUSINESS),
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
  deliveryManagerIds: idList,
  roles: z.array(projectRoleSchema).default([]),
});

export type CreateProjectInput = z.input<typeof createProjectSchema>;
