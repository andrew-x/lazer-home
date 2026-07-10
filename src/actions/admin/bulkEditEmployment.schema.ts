import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { billableTypeEnum, staffEmployment } from "@/lib/db/schema";
import { isEmploymentInvariantSatisfied } from "@/lib/employment";

/**
 * One staff member's edited employment facts in a bulk edit. Built from the
 * Drizzle insert schema (single source of truth for the enums), with the
 * defaulted/loosely-typed columns tightened: the client always sends each row's
 * full current state, so every fact is required here, and `utilizationTarget` is
 * bounded 0–100. The billable/target invariant is the shared one from
 * `@/lib/employment` (also enforced by the import's `normalizedStaffSchema`).
 */
const employmentChangeSchema = createInsertSchema(staffEmployment)
  .pick({
    lineOfBusiness: true,
    role: true,
    employmentType: true,
  })
  .extend({
    staffId: z.string().min(1),
    isBillable: z.boolean(),
    utilizationTarget: z.number().int().min(0).max(100),
    billableType: z.enum(billableTypeEnum.enumValues),
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
