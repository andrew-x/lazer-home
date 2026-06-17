"use server";

import { publicActionClient } from "@/lib/action";
import { assertLocalhost } from "@/lib/admin";
import { computeImportPlan } from "@/lib/staff-import/plan";
import { staffImportInputSchema } from "./staffImport.schema";

/**
 * Diff transformed CSV rows against the database and return the create/update
 * plan for review. Read-only. Localhost-gated (the admin area's boundary);
 * `publicActionClient` because local seeding shouldn't require an auth/staff
 * record (the import is what creates staff in the first place).
 */
export const previewStaffImport = publicActionClient
  .metadata({ action: "preview-staff-import" })
  .inputSchema(staffImportInputSchema)
  .action(async ({ parsedInput: { rows } }) => {
    await assertLocalhost();
    return computeImportPlan(rows);
  });
