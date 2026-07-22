"use server";

import { searchStaffByName } from "@/actions/shared/entitySearch";
import { secureActionClient } from "@/lib/core/action";
import { searchQuerySchema } from "@/lib/core/search";

/**
 * Type-ahead search for the project form's staff pickers (delivery managers and
 * per-role staff). Same query as the CRM staff search, but gated on
 * `projects.edit` so a delivery manager (who has `projects.edit` but not
 * `crm.edit`) can drive the picker without gaining CRM write access.
 */
export const searchStaff = secureActionClient
  .metadata({
    action: "search-project-staff",
    permission: { projects: ["edit"] },
  })
  .inputSchema(searchQuerySchema)
  .action(({ parsedInput: { query } }) => searchStaffByName(query));
