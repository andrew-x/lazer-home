"use server";

import { localActionClient } from "@/lib/action";
import { computePtoImportPlan } from "@/lib/pto-import/plan";
import { ptoImportInputSchema } from "./ptoImport.schema";

/**
 * Diff transformed PTO CSV rows against the database and return the
 * create/update/delete plan for review. Read-only. `localActionClient` = the
 * localhost host gate (the admin area's boundary) with no auth requirement,
 * because local seeding shouldn't need an auth/staff record. See
 * previewStaffImport for the auth rationale.
 */
export const previewPtoImport = localActionClient
  .metadata({ action: "preview-pto-import" })
  .inputSchema(ptoImportInputSchema)
  .action(async ({ parsedInput: { rows } }) => {
    return computePtoImportPlan(rows);
  });
