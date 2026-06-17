"use server";

import { publicActionClient } from "@/lib/action";
import { assertLocalhost } from "@/lib/admin";
import { computePtoImportPlan } from "@/lib/pto-import/plan";
import { ptoImportInputSchema } from "./ptoImport.schema";

/**
 * Diff transformed PTO CSV rows against the database and return the
 * create/update/delete plan for review. Read-only. Localhost-gated (the admin
 * area's boundary); `publicActionClient` because local seeding shouldn't require
 * an auth/staff record. See previewStaffImport for the auth rationale.
 */
export const previewPtoImport = publicActionClient
  .metadata({ action: "preview-pto-import" })
  .inputSchema(ptoImportInputSchema)
  .action(async ({ parsedInput: { rows } }) => {
    await assertLocalhost();
    return computePtoImportPlan(rows);
  });
