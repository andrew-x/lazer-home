import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { billableTypeEnum, staffEmployment } from "@/lib/db/schema";

/**
 * One staff member's edited employment facts in a bulk edit. Built from the
 * Drizzle insert schema (single source of truth for the enums), with the
 * defaulted/loosely-typed columns tightened: the client always sends each row's
 * full current state, so every fact is required here, and `utilizationTarget` is
 * bounded 0–100. The billable/target invariant mirrors the import's
 * `normalizedStaffSchema`.
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
  .refine((r) => r.isBillable || r.utilizationTarget === 0, {
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
