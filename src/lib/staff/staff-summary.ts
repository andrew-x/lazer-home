/**
 * The muted identity sub-line shown under a person's name in a dense list: their
 * line of business, role, employment type, delivery pool and location, joined with
 * a middot. A pure, client-importable module (no `db`/drizzle).
 *
 * Lives here rather than beside one table because two surfaces render the same line
 * over two different row types (the compensation-plan grid and the plan's staff
 * picker), and they had drifted into identical copies of the same function.
 */

import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import type {
  BillableType,
  EmploymentType,
  Role,
} from "@/lib/staff/staff-enums";
import {
  BILLABLE_TYPE_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  ROLE_LABELS,
} from "@/lib/staff/staff-enums";

/**
 * Every facet is optional so any row shape carrying a subset satisfies this
 * structurally — callers pass their row straight in.
 */
export type StaffMetaLineParts = {
  lineOfBusiness?: LineOfBusiness | null;
  role?: Role | null;
  employmentType?: EmploymentType | null;
  billableType?: BillableType | null;
  location?: string | null;
};

/** Absent facets are dropped rather than rendered as a gap or a placeholder. */
export function staffMetaLine({
  lineOfBusiness,
  role,
  employmentType,
  billableType,
  location,
}: StaffMetaLineParts): string {
  return [
    lineOfBusiness ? LINE_OF_BUSINESS_LABELS[lineOfBusiness] : null,
    role ? ROLE_LABELS[role] : null,
    employmentType ? EMPLOYMENT_TYPE_LABELS[employmentType] : null,
    billableType ? BILLABLE_TYPE_LABELS[billableType] : null,
    location,
  ]
    .filter(Boolean)
    .join(" · ");
}
