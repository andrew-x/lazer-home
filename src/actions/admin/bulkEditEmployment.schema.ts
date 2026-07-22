import { z } from "zod";
import { LINE_OF_BUSINESS } from "@/lib/crm/line-of-business";
import { id } from "@/lib/schemas/id-schema";
import { isEmploymentInvariantSatisfied } from "@/lib/staff/employment";
import {
  BILLABLE_TYPE_LABELS,
  type BillableType,
  EMPLOYMENT_TYPE_LABELS,
  type EmploymentType,
  ROLE_LABELS,
  type Role,
} from "@/lib/staff/staff-enums";

/**
 * A pure, client-importable module (no `db`/drizzle) so the bulk-edit UI and the
 * commit action share one schema. The staff-employment enum value sets are
 * reused via the label maps in `@/lib/staff/staff-enums` (each keyed by the full enum
 * union, so a `Record` type keeps them in lockstep with the schema enums) and
 * `LINE_OF_BUSINESS` — no Drizzle enum import. See the "schema modules by
 * boundary" rule in `.claude/rules/server-actions.md`.
 */
const ROLES = Object.keys(ROLE_LABELS) as [Role, ...Role[]];
const EMPLOYMENT_TYPES = Object.keys(EMPLOYMENT_TYPE_LABELS) as [
  EmploymentType,
  ...EmploymentType[],
];
const BILLABLE_TYPES = Object.keys(BILLABLE_TYPE_LABELS) as [
  BillableType,
  ...BillableType[],
];

/**
 * One staff member's edited employment facts in a bulk edit. Every fact is
 * required (the client always sends each row's full current state) and
 * `utilizationTarget` is bounded 0–100. The billable/target invariant is the
 * shared one from `@/lib/staff/employment` (also enforced by the import's
 * `normalizedStaffSchema`).
 */
const employmentChangeSchema = z
  .object({
    lineOfBusiness: z.enum(LINE_OF_BUSINESS),
    role: z.enum(ROLES),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    staffId: id,
    isBillable: z.boolean(),
    utilizationTarget: z.number().int().min(0).max(100),
    billableType: z.enum(BILLABLE_TYPES),
    isManagement: z.boolean(),
  })
  .refine(isEmploymentInvariantSatisfied, {
    message: "Utilization target must be 0 when not billable.",
    path: ["utilizationTarget"],
  });

/**
 * Bulk-edit payload. `effectiveDate` null → correct the latest employment row in
 * place; a date → insert a new effective-dated row per staff (the date must be
 * after each affected staff's latest effective date — enforced server-side).
 */
export const bulkEditEmploymentSchema = z.object({
  effectiveDate: z.iso.date().nullable(),
  changes: z.array(employmentChangeSchema).min(1),
});

export type EmploymentChange = z.infer<typeof employmentChangeSchema>;
export type BulkEditEmploymentInput = z.infer<typeof bulkEditEmploymentSchema>;

/**
 * The editable employment facts — every field of an {@link EmploymentChange}
 * except its `staffId` key. The single source of truth for the fact list: the
 * bulk-edit UI diffs against it and the commit action uses it to skip no-ops.
 * Adding a fact means adding it to `employmentChangeSchema` and this list.
 */
export const FACT_FIELDS = [
  "lineOfBusiness",
  "role",
  "employmentType",
  "isBillable",
  "utilizationTarget",
  "billableType",
  "isManagement",
] as const satisfies readonly (keyof EmploymentChange)[];

export type FactField = (typeof FACT_FIELDS)[number];
