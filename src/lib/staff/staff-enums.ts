/**
 * Human-readable labels for the staff Postgres enums (`role`, `employment_type`,
 * `billable_type`, `pto_type`). The enum *values* stay defined inline in
 * `staff-schema.ts` (the single source of truth); this module only maps each
 * value to a display label, so the UI never falls back to `humanizeEnum` — which
 * mangles acronyms (e.g. `QA` → "Qa"). Mirrors `@/lib/crm/line-of-business`,
 * `@/lib/projects/project-role-type`, and `@/lib/format/currency`.
 *
 * The union types are derived from the schema enums via `import type`, so the
 * label maps stay in lockstep with the enums and this module pulls in no Drizzle
 * runtime (it is client-safe).
 */
import type {
  billableTypeEnum,
  employmentTypeEnum,
  ptoTypeEnum,
  roleEnum,
} from "@/lib/db/staff-schema";

export type Role = (typeof roleEnum.enumValues)[number];
export type EmploymentType = (typeof employmentTypeEnum.enumValues)[number];
export type BillableType = (typeof billableTypeEnum.enumValues)[number];
export type PtoType = (typeof ptoTypeEnum.enumValues)[number];

/** Discipline a staff member works in. `QA` stays uppercase (it's an acronym). */
export const ROLE_LABELS: Record<Role, string> = {
  ENGINEER: "Engineer",
  DESIGNER: "Designer",
  LEADERSHIP: "Leadership",
  SALES: "Sales",
  SOLUTIONS: "Solutions",
  OPERATIONS: "Operations",
  ARCHITECT: "Architect",
  DELIVERY: "Delivery",
  QA: "QA",
};

/** Whether the person is salaried full-time or paid hourly. */
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: "Full time",
  HOURLY: "Hourly",
};

/** Which delivery pool bills the person's time. */
export const BILLABLE_TYPE_LABELS: Record<BillableType, string> = {
  HUB: "Hub",
  GLOBAL: "Global",
};

/** Kind of leave for a PTO span. */
export const PTO_TYPE_LABELS: Record<PtoType, string> = {
  VACATION: "Vacation",
  STATUTORY_HOLIDAY: "Statutory holiday",
  SICK_LEAVE: "Sick leave",
  UNPAID_LEAVE: "Unpaid leave",
  PARENTAL_LEAVE: "Parental leave",
  BEREAVEMENT_LEAVE: "Bereavement leave",
  COMPANY_RETREAT: "Company retreat",
  RELIGIOUS_HOLIDAY: "Religious holiday",
  JURY_DUTY: "Jury duty",
  LEAVE_OF_ABSENCE: "Leave of absence",
  OTHER_LEAVE: "Other leave",
};
