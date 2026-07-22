"use server";

import { z } from "zod";
import { secureActionClient } from "@/lib/core/action";
import { id } from "@/lib/schemas/id-schema";
import { getOpportunity } from "./getOpportunity";

/**
 * Client-triggered detail load for the opportunity drawer (the interactive-read
 * exception to the server-only read rule — same shape as `searchStaff`). Gated on
 * `crm.edit`: the drawer is edit-only, so this can't leak detail past the write
 * gate. Delegates to the server-only `getOpportunity` read.
 */
export const loadOpportunityDetail = secureActionClient
  .metadata({
    action: "load-opportunity-detail",
    permission: { crm: ["edit"] },
  })
  .inputSchema(z.object({ id }))
  .action(({ parsedInput }) => getOpportunity(parsedInput.id));
