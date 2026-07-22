"use server";

import { localActionClient } from "@/lib/core/action";
import { computeImportPlan } from "@/lib/staff/staff-import/plan";
import { staffImportInputSchema } from "./staffImport.schema";

/**
 * Diff transformed CSV rows against the database and return the create/update
 * plan for review. Read-only. `localActionClient` = the localhost host gate (the
 * admin area's boundary) with no auth requirement, because local seeding
 * shouldn't need an auth/staff record (the import is what creates staff in the
 * first place).
 */
export const previewStaffImport = localActionClient
  .metadata({ action: "preview-staff-import" })
  .inputSchema(staffImportInputSchema)
  .action(async ({ parsedInput: { rows } }) => {
    return computeImportPlan(rows);
  });
