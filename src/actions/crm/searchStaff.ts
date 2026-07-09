"use server";

import { searchStaffByName } from "@/actions/shared/entitySearch";
import { secureActionClient } from "@/lib/action";
import { searchQuerySchema } from "@/lib/search";

/**
 * Type-ahead search for the opportunity form's staff pickers (owners, referral
 * staff). Matches active staff by name; returns up to `SEARCH_LIMIT`
 * `{ id, name }` for a non-blank query (blank → nothing). Gated on `crm.edit` —
 * stricter than the open staff directory read, so it can't enumerate the roster
 * past the write gate. The query body is shared with the projects staff picker
 * via `searchStaffByName`.
 */
export const searchStaff = secureActionClient
  .metadata({
    action: "search-staff",
    permission: { crm: ["edit"] },
  })
  .inputSchema(searchQuerySchema)
  .action(({ parsedInput: { query } }) => searchStaffByName(query));
