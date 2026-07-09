"use server";

import { searchCompaniesByName } from "@/actions/shared/entitySearch";
import { secureActionClient } from "@/lib/action";
import { searchQuerySchema } from "@/lib/search";

/**
 * Type-ahead search for the project form's company picker. Same query as the CRM
 * company search, but gated on `projects.edit` so project editors can pick a
 * company without needing CRM write access.
 */
export const searchCompanies = secureActionClient
  .metadata({
    action: "search-project-companies",
    permission: { projects: ["edit"] },
  })
  .inputSchema(searchQuerySchema)
  .action(({ parsedInput: { query } }) => searchCompaniesByName(query));
